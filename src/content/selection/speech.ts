// Reading the source aloud with the browser's own voices (plan 4.5 rule 4).
//
// `speechSynthesis` has no way to cancel one utterance: `cancel()` empties the whole
// queue, the page's utterances included. So it is called only while ours is the one
// speaking and nothing waits behind it (`pending` is false). Otherwise the page's speech
// wins: ours is only marked stopped (the card shows it stopped at once) and its later
// events are ignored, even though it may still play out or start later.
//
// The voice (pickVoice): a local high-quality one first, then Chrome's online Google
// voices; within a tier, the system's default local voice first. Privacy: an online
// Google voice sends the text it reads (the source) to Google. An online voice that
// fails (offline) is retried once with the best local voice. With no reliable source
// language, no voice and no lang: the browser's default.

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
const tagOf = (tag: string) => tag.toLowerCase().replace(/_/g, '-');
const primaryOf = (tag: string) => tagOf(tag).split('-')[0];

/** 0 is best: local high quality, Google online, other local; 3 is never picked. */
function rank(voice: VoiceLike): number {
  if (voice.localService) return QUALITY.test(voice.name) ? 0 : 2;
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

export interface Speech {
  /** Whether a voice exists; waits up to a second for the list. Never rejects. */
  available(): Promise<boolean>;
  /** Reads `text`; `lang` is the detected source language, if reliable. */
  speak(text: string, lang: string | undefined, onEnd: () => void): void;
  /** Stops our own utterance, if it is still going. */
  stop(): void;
  speaking(): boolean;
}

export function createSpeech(env: SpeechEnv): Speech {
  const { synth } = env;
  let own: SpeechSynthesisUtterance | undefined;
  let ended: (() => void) | undefined;
  /** Ours is the utterance being spoken (not waiting behind the page's). */
  let started = false;
  /** Stopped while still queued: cancelled the moment it starts. */
  const abandoned = new WeakSet<SpeechSynthesisUtterance>();
  let checking: Promise<boolean> | undefined;

  const finish = (utterance: SpeechSynthesisUtterance) => {
    if (own !== utterance) return;
    own = undefined;
    started = false;
    const callback = ended;
    ended = undefined;
    callback?.();
  };

  /** Speaks as our utterance; `retry`: an online voice failing gets one local attempt. */
  function say(text: string, lang: string | undefined, voice: unknown, retry: boolean) {
    if (!synth || !env.createUtterance) return;
    const utterance = env.createUtterance(text);
    if (lang) utterance.lang = lang;
    if (voice) utterance.voice = voice as SpeechSynthesisVoice;
    utterance.onstart = () => {
      // Stopped while queued: cancelled now, unless the page queued speech behind it.
      if (abandoned.has(utterance)) {
        if (!synth.pending) synth.cancel();
      } else if (own === utterance) started = true;
    };
    utterance.onend = () => finish(utterance);
    utterance.onerror = (event) => {
      const reason = (event as Partial<SpeechSynthesisErrorEvent> | undefined)?.error;
      // Cut off (by us or the page) is not a failure of the voice.
      const failed = reason !== 'canceled' && reason !== 'interrupted';
      if (
        retry &&
        failed &&
        lang &&
        own === utterance &&
        voice &&
        !(voice as VoiceLike).localService
      ) {
        const local = pickVoice(synth.getVoices(), lang, { local: true });
        if (local) return say(text, lang, local, false);
      }
      finish(utterance);
    };
    own = utterance;
    started = false;
    synth.speak(utterance);
  }

  return {
    available() {
      if (!synth || !env.createUtterance) return Promise.resolve(false);
      if (synth.getVoices().length > 0) return Promise.resolve(true);
      checking ??= new Promise<boolean>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          synth.removeEventListener('voiceschanged', done);
          checking = undefined;
          resolve(synth.getVoices().length > 0);
        };
        const timer = setTimeout(done, VOICES_WAIT_MS);
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
      // `cancel` empties the whole queue (see the top of the file): only while ours is
      // the one speaking with nothing behind it. One still queued is cancelled when it
      // starts; one with the page's speech behind it is left to finish, unheard of.
      if (started && synth.speaking && !synth.pending) synth.cancel();
      else if (!started) abandoned.add(utterance);
      started = false;
    },
    speaking: () => !!own,
  };
}
