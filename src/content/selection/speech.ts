// Reading the source aloud with the browser's own voices (plan 4.5 rule 4).
//
// `speechSynthesis` has no way to cancel one utterance: `cancel()` empties the whole
// queue, the page's utterances included. So it is called only when the queue holds
// nothing but ours: ours speaking with nothing behind it (`pending` is false), or ours
// still waiting with only ours ahead. Otherwise the page's speech wins: ours is only
// marked stopped (the card shows it stopped at once) and its later events are ignored,
// even though it may still play out or start later.
//
// Chrome stalls for good on an online voice spoken right after `cancel()`: the new
// utterance never starts, `speaking` stays true and every utterance after it, in every
// tab, waits behind it until the next `cancel()`. So after our own `cancel()` the next
// utterance waits SETTLE_MS; one that still has not started after START_TIMEOUT_MS
// with only ours queued is cancelled and, for an online voice, tried once more with the
// best local voice. One that started but never ends is given up after an estimate of
// its length (speakingLimit), pushed back by each word boundary the voice reports.
//
// The voice (pickVoice): a local high-quality one first, then Chrome's online Google
// voices; within a tier, the system's default local voice first; macOS's novelty voices
// never. Privacy: an online Google voice sends the text it reads (the source) to Google.
// An online voice that fails (offline) is retried once with the best local voice. With
// no reliable source language, no voice and no lang: the browser's default.

/** The parts of `speechSynthesis` used here, so tests can pass a fake. */
export interface SynthLike {
  readonly speaking: boolean;
  /** Utterances are queued behind the one speaking. */
  readonly pending: boolean;
  getVoices(): readonly unknown[];
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
  addEventListener(type: 'voiceschanged', listener: () => void): void;
  removeEventListener(type: 'voiceschanged', listener: () => void): void;
}

export interface SpeechEnv {
  synth?: SynthLike;
  createUtterance?(text: string): SpeechSynthesisUtterance;
}

/** The fields of `SpeechSynthesisVoice` the choice looks at. */
interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

const QUALITY = /enhanced|premium|siri|neural/i;
/** macOS's novelty voices (sound effects, singing): never read a word with them. */
const NOVELTY =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Pipe Organ|Princess|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/;
const tagOf = (tag: string) => tag.toLowerCase().replace(/_/g, '-');
const primaryOf = (tag: string) => tagOf(tag).split('-')[0];

/** 0 is best: local high quality, Google online, other local; 3 is never picked. */
function rank(voice: VoiceLike): number {
  if (voice.localService) {
    if (NOVELTY.test(voice.name)) return 3;
    return QUALITY.test(voice.name) ? 0 : 2;
  }
  return voice.name.startsWith('Google') ? 1 : 3;
}

/** Whether `a` beats `b`: a better tier, or the same tier and only `a` the default local voice. */
function better(a: VoiceLike, b: VoiceLike): boolean {
  const diff = rank(a) - rank(b);
  return diff < 0 || (diff === 0 && a.localService && !!a.default && !b.default);
}

/**
 * The voice for `lang`: among the voices of exactly that tag (else of the same primary
 * language), the best ranked, the default local voice first within a tier, then the
 * first listed; undefined leaves it to the browser. `local`: local voices only.
 */
export function pickVoice<T>(
  voices: readonly T[],
  lang: string,
  options: { local?: boolean } = {},
): T | undefined {
  const valid = (
    voices.filter(
      (voice) =>
        !!voice &&
        typeof (voice as Partial<VoiceLike>).name === 'string' &&
        typeof (voice as Partial<VoiceLike>).lang === 'string',
    ) as (T & VoiceLike)[]
  ).filter((voice) => !options.local || voice.localService);
  const exact = valid.filter((voice) => tagOf(voice.lang) === tagOf(lang));
  const pool = exact.length
    ? exact
    : valid.filter((voice) => primaryOf(voice.lang) === primaryOf(lang));
  let best: (T & VoiceLike) | undefined;
  for (const voice of pool) {
    if (rank(voice) < 3 && (!best || better(voice, best))) best = voice;
  }
  return best;
}

/** An empty voice list may still be loading: wait this long for `voiceschanged`. */
export const VOICES_WAIT_MS = 1000;
/** After our own `cancel()`, the next utterance waits this long (Chrome's stall). */
export const SETTLE_MS = 250;
/** Not started this long after it was spoken, with only ours queued: stalled. */
export const START_TIMEOUT_MS = 3500;

const LIMIT_BASE_MS = 4000;
const LIMIT_PER_CHAR_MS = 120;
const LIMIT_MAX_MS = 60_000;
/** Han, kana, hangul and full-width forms: about three times as long to say as a letter. */
const WIDE = /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿＀-￯]/g;

/** How long `text` may take once started before it is given up (no `end` came). */
export function speakingLimit(text: string): number {
  const weight = text.length + 2 * (text.match(WIDE)?.length ?? 0);
  return Math.min(LIMIT_BASE_MS + LIMIT_PER_CHAR_MS * weight, LIMIT_MAX_MS);
}

export interface Speech {
  /** Whether a voice exists; waits up to a second for the list. Never rejects. */
  available(): Promise<boolean>;
  /**
   * Reads `text`; `lang` is the detected source language, if reliable. `onEnd` follows
   * once it is over, unless stopped first; `failed`: no voice could read it.
   */
  speak(text: string, lang: string | undefined, onEnd: (failed: boolean) => void): void;
  /** Stops our own utterance, if it is still going. */
  stop(): void;
  speaking(): boolean;
}

export function createSpeech(env: SpeechEnv): Speech {
  const { synth } = env;
  let own: SpeechSynthesisUtterance | undefined;
  let ended: ((failed: boolean) => void) | undefined;
  /** Ours is the utterance being spoken (not waiting behind the page's). */
  let started = false;
  /** Stopped while still queued: cancelled the moment it starts. */
  const abandoned = new WeakSet<SpeechSynthesisUtterance>();
  /** Ours that are in the synth's queue: spoken, neither ended nor failed nor cancelled. */
  const queued = new Set<SpeechSynthesisUtterance>();
  /** The synth's queue holds nothing but ours (as of our last speak or cancel). */
  let mine = false;
  let cancelledAt = Number.NEGATIVE_INFINITY;
  /** The one timer of `own`: settling, waiting for its start, or for its end. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checking: Promise<boolean> | undefined;

  const arm = (ms: number, then: () => void) => {
    clearTimeout(timer);
    timer = setTimeout(then, ms);
  };

  /** Empties the queue: only ever with nothing but ours in it. */
  const cancel = () => {
    cancelledAt = Date.now();
    queued.clear();
    mine = true;
    synth?.cancel();
  };

  const finish = (utterance: SpeechSynthesisUtterance, failed = false) => {
    if (own !== utterance) return;
    clearTimeout(timer);
    own = undefined;
    started = false;
    const callback = ended;
    ended = undefined;
    callback?.(failed);
  };

  /**
   * Speaks as our utterance. `first`: an online voice failing or stalling gets one more
   * attempt with the best local voice.
   */
  function say(text: string, lang: string | undefined, voice: unknown, first: boolean) {
    if (!synth || !env.createUtterance) return;
    const utterance = env.createUtterance(text);
    if (lang) utterance.lang = lang;
    if (voice) utterance.voice = voice as SpeechSynthesisVoice;
    /** The second attempt, if this is the first with an online voice and a local one exists. */
    const again = () => {
      if (!first || !lang || !voice || (voice as VoiceLike).localService) return false;
      const local = pickVoice(synth.getVoices(), lang, { local: true });
      if (local) say(text, lang, local, false);
      return !!local;
    };
    /** Started but no end in time: given up, not a failure (it was heard, or most of it). */
    const awaitEnd = (rest: string) =>
      arm(speakingLimit(rest), () => {
        if (own !== utterance) return;
        if (!synth.pending) cancel();
        finish(utterance);
      });
    utterance.onstart = () => {
      // Stopped while queued: cancelled now, unless the page queued speech behind it.
      if (abandoned.has(utterance)) {
        if (!synth.pending) cancel();
      } else if (own === utterance) {
        started = true;
        awaitEnd(text);
      }
    };
    // Each word the voice reports pushes the limit back (local voices report them).
    utterance.onboundary = (event) => {
      if (own === utterance && started) awaitEnd(text.slice(event.charIndex));
    };
    utterance.onend = () => {
      queued.delete(utterance);
      finish(utterance);
    };
    utterance.onerror = (event) => {
      queued.delete(utterance);
      const reason = (event as Partial<SpeechSynthesisErrorEvent> | undefined)?.error;
      // Cut off (by us or the page) is not a failure of the voice.
      const failed = reason !== 'canceled' && reason !== 'interrupted';
      if (failed && own === utterance && again()) return;
      finish(utterance, failed);
    };
    const enqueue = () => {
      if (own !== utterance) return;
      // Ahead of it: nothing, or only ours.
      const ours = (!synth.speaking && !synth.pending) || (mine && queued.size > 0);
      mine = ours;
      queued.add(utterance);
      synth.speak(utterance);
      arm(START_TIMEOUT_MS, () => {
        // The page's speech ahead of it may take long: it waits for that.
        if (own !== utterance || started || !ours) return;
        cancel();
        if (!again()) finish(utterance, true);
      });
    };
    own = utterance;
    started = false;
    const wait = cancelledAt + SETTLE_MS - Date.now();
    if (wait > 0) arm(wait, enqueue);
    else enqueue();
  }

  return {
    available() {
      if (!synth || !env.createUtterance) return Promise.resolve(false);
      if (synth.getVoices().length > 0) return Promise.resolve(true);
      checking ??= new Promise<boolean>((resolve) => {
        const done = () => {
          clearTimeout(wait);
          synth.removeEventListener('voiceschanged', done);
          checking = undefined;
          resolve(synth.getVoices().length > 0);
        };
        const wait = setTimeout(done, VOICES_WAIT_MS);
        synth.addEventListener('voiceschanged', done);
      });
      return checking;
    },
    speak(text, lang, onEnd) {
      if (!synth || !env.createUtterance) return;
      this.stop();
      ended = onEnd;
      say(text, lang, lang ? pickVoice(synth.getVoices(), lang) : undefined, true);
    },
    stop() {
      if (!own || !synth) return;
      const utterance = own;
      own = undefined;
      ended = undefined;
      clearTimeout(timer);
      // Still settling: never spoken. Otherwise `cancel` only with nothing but ours in
      // the queue (see the top of the file): ours speaking with nothing behind it, or
      // ours waiting behind only ours (a quick second click). One waiting behind the
      // page's is cancelled when it starts; one with the page's behind it plays out.
      if (queued.has(utterance)) {
        if (started ? synth.speaking && !synth.pending : mine) cancel();
        else if (!started) abandoned.add(utterance);
      }
      started = false;
    },
    speaking: () => !!own,
  };
}
