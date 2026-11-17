import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSpeech,
  pickVoice,
  SETTLE_MS,
  START_TIMEOUT_MS,
  type SynthLike,
  speakingLimit,
  VOICES_WAIT_MS,
} from './speech';

interface FakeUtterance {
  text: string;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onboundary: ((event: { charIndex: number }) => void) | null;
  voice?: unknown;
}

function fakeSynth(voices: unknown[] = ['voice']) {
  const listeners = new Set<() => void>();
  const queue: FakeUtterance[] = [];
  const synth = {
    speaking: false,
    /** Utterances queued behind the one speaking (the page's, in these tests). */
    pending: false,
    voices,
    getVoices: () => synth.voices,
    speak: vi.fn((utterance: FakeUtterance) => {
      queue.push(utterance);
    }),
    cancel: vi.fn(() => {
      queue.length = 0;
      synth.speaking = false;
    }),
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    /** The next queued utterance starts. */
    start() {
      synth.speaking = true;
      queue[0]?.onstart?.();
    },
    end() {
      const utterance = queue.shift();
      synth.speaking = queue.length > 0;
      utterance?.onend?.();
    },
    /** The utterance speaking fails (`network`: an online voice with no connection). */
    fail(error = 'network') {
      const utterance = queue.shift();
      synth.speaking = queue.length > 0;
      utterance?.onerror?.({ error });
    },
    voicesChanged(next: unknown[]) {
      synth.voices = next;
      for (const listener of listeners) listener();
    },
    queue,
    listeners,
  };
  const speech = createSpeech({
    synth: synth as unknown as SynthLike,
    createUtterance: (text) =>
      ({
        text,
        lang: '',
        onstart: null,
        onend: null,
        onerror: null,
        onboundary: null,
      }) as unknown as SpeechSynthesisUtterance,
  });
  return { synth, speech };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('speech (plan 4.5 rule 4)', () => {
  it('reads the source with the detected language, or none', () => {
    vi.useFakeTimers();
    const { synth, speech } = fakeSynth();
    speech.speak('A paper map', 'en', () => {});
    expect(synth.queue[0]).toMatchObject({ text: 'A paper map', lang: 'en' });
    speech.speak('map', undefined, () => {});
    vi.advanceTimersByTime(SETTLE_MS);
    expect(synth.queue.at(-1)?.lang).toBe('');
  });

  it('waits up to a second for voiceschanged before saying no voice', async () => {
    vi.useFakeTimers();
    const { synth, speech } = fakeSynth([]);
    const later = speech.available();
    synth.voicesChanged(['voice']);
    expect(await later).toBe(true);
    synth.voices = [];
    const never = speech.available();
    await vi.advanceTimersByTimeAsync(VOICES_WAIT_MS);
    expect(await never).toBe(false);
    expect(synth.listeners.size).toBe(0);
  });

  it('is unavailable without speechSynthesis', async () => {
    expect(await createSpeech({}).available()).toBe(false);
  });

  it('cancels only its own utterance, once it is the one speaking', () => {
    const { synth, speech } = fakeSynth();
    // The page is reading something itself: ours waits in the queue.
    synth.speaking = true;
    const onEnd = vi.fn();
    speech.speak('mine', 'en', onEnd);
    speech.stop();
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(speech.speaking()).toBe(false);
    // When the abandoned one finally starts, it is cancelled then.
    synth.end = () => {};
    synth.queue[0]?.onstart?.();
    expect(synth.cancel).toHaveBeenCalledOnce();
  });

  it('never empties a queue the page added to: ours is only marked stopped', () => {
    const { synth, speech } = fakeSynth();
    const onEnd = vi.fn();
    speech.speak('mine', 'en', onEnd);
    synth.start();
    // The page queues its own utterance behind ours.
    synth.pending = true;
    speech.stop();
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(speech.speaking()).toBe(false);
    // Ours plays out; its events are ignored.
    synth.end();
    expect(onEnd).not.toHaveBeenCalled();
    expect(speech.speaking()).toBe(false);
  });

  it('an abandoned utterance starting with the page’s speech queued behind is left alone', () => {
    const { synth, speech } = fakeSynth();
    synth.speaking = true;
    speech.speak('mine', 'en', () => {});
    speech.stop();
    synth.pending = true;
    synth.queue[0]?.onstart?.();
    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it('stops its own utterance while it speaks, and reports the end', () => {
    vi.useFakeTimers();
    const { synth, speech } = fakeSynth();
    const onEnd = vi.fn();
    speech.speak('mine', 'en', onEnd);
    synth.start();
    expect(speech.speaking()).toBe(true);
    speech.stop();
    expect(synth.cancel).toHaveBeenCalledOnce();
    speech.speak('again', 'en', onEnd);
    vi.advanceTimersByTime(SETTLE_MS);
    synth.start();
    synth.end();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(speech.speaking()).toBe(false);
    // Nothing of ours is speaking: stop leaves the page's speech alone.
    synth.speaking = true;
    speech.stop();
    expect(synth.cancel).toHaveBeenCalledOnce();
  });
});

const voice = (name: string, lang: string, localService = true, isDefault = false) => ({
  name,
  lang,
  localService,
  default: isDefault,
});

describe('pickVoice (scheme A)', () => {
  const plain = voice('Samantha', 'en-US');
  const enhanced = voice('Ava (Enhanced)', 'en-US');
  const google = voice('Google US English', 'en-US', false);
  const remote = voice('Microsoft Aria Online (Natural)', 'en-US', false);

  it('prefers a local high-quality voice, then Google online, then any local one', () => {
    expect(pickVoice([plain, google, enhanced], 'en-US')).toBe(enhanced);
    expect(pickVoice([plain, google], 'en-US')).toBe(google);
    expect(pickVoice([remote, plain], 'en-US')).toBe(plain);
  });

  it('knows each high-quality marker, ignoring case', () => {
    for (const name of ['Zoe (premium)', 'Siri Voice 2', 'Local NEURAL voice', 'x enhanced']) {
      expect(pickVoice([plain, voice(name, 'en-US')], 'en-US')?.name).toBe(name);
    }
    // A marker counts only on a local voice; an online one is not Google either.
    expect(pickVoice([plain, voice('Cloud Neural', 'en-US', false)], 'en-US')).toBe(plain);
    // "Google" must start the name, and the voice must be online.
    expect(pickVoice([voice('My Google', 'en-US', false)], 'en-US')).toBeUndefined();
  });

  it('among local voices of the same tier, the default one first', () => {
    const fallback = voice('Fred', 'en-US', true, true);
    expect(pickVoice([plain, fallback], 'en-US')).toBe(fallback);
    // Quality still comes first; the default only breaks a tie.
    expect(pickVoice([fallback, enhanced], 'en-US')).toBe(enhanced);
    const enhancedDefault = voice('Zoe (Premium)', 'en-US', true, true);
    expect(pickVoice([enhanced, enhancedDefault], 'en-US')).toBe(enhancedDefault);
  });

  it('local only: never an online voice', () => {
    expect(pickVoice([google, plain], 'en-US', { local: true })).toBe(plain);
    expect(pickVoice([google, remote], 'en-US', { local: true })).toBeUndefined();
  });

  it('never a macOS novelty voice, even the default one', () => {
    const novelty = ['Albert', 'Bad News', 'Bells', 'Bubbles', 'Good News', 'Whisper', 'Zarvox'];
    const voices = novelty.map((name) => voice(name, 'en-US', true, name === 'Bells'));
    expect(pickVoice(voices, 'en-US')).toBeUndefined();
    expect(pickVoice([...voices, plain], 'en-US')).toBe(plain);
    expect(pickVoice([...voices, google, plain], 'en-US', { local: true })).toBe(plain);
    // Only the name itself: another voice merely starting with the same letters is kept.
    expect(pickVoice([voice('Albertine', 'en-US')], 'en-US')?.name).toBe('Albertine');
  });

  it('leaves it to the browser when nothing fits', () => {
    expect(pickVoice([remote], 'en-US')).toBeUndefined();
    expect(pickVoice([], 'en')).toBeUndefined();
    expect(pickVoice([voice('Thomas', 'fr-FR')], 'en')).toBeUndefined();
    expect(pickVoice(['not a voice', null], 'en')).toBeUndefined();
  });

  it('matches the exact tag first, then the same primary language', () => {
    const uk = voice('Daniel (Enhanced)', 'en-GB');
    // Exact beats a better voice of another region.
    expect(pickVoice([uk, plain], 'en-US')).toBe(plain);
    // No exact match: any English, still by quality.
    expect(pickVoice([plain, uk], 'en-AU')).toBe(uk);
    expect(pickVoice([voice('Tingting', 'zh-CN'), plain], 'en')).toBe(plain);
    // Tags compare case-insensitively, with _ as -.
    expect(pickVoice([voice('Ting', 'zh_CN')], 'zh-cn')?.name).toBe('Ting');
    // zh-TW does not take a zh-CN voice as exact, but takes it before none.
    const tw = voice('Meijia', 'zh-TW');
    expect(pickVoice([voice('Tingting', 'zh-CN'), tw], 'zh-TW')).toBe(tw);
  });
});

describe('speak picks the voice', () => {
  it('sets the voice for a reliable language, none without one', () => {
    vi.useFakeTimers();
    const enhanced = voice('Ava (Enhanced)', 'en-US');
    const { speech, synth } = fakeSynth([voice('Samantha', 'en-US'), enhanced]);
    speech.speak('A paper map', 'en', () => {});
    expect((synth.queue[0] as unknown as { voice?: unknown }).voice).toBe(enhanced);
    speech.speak('map', undefined, () => {});
    vi.advanceTimersByTime(SETTLE_MS);
    const last = synth.queue.at(-1) as unknown as { voice?: unknown; lang: string };
    expect(last.voice).toBeUndefined();
    expect(last.lang).toBe('');
  });
});

describe('an online voice that fails (no network)', () => {
  const google = voice('Google US English', 'en-US', false);
  const plain = voice('Samantha', 'en-US');
  const fallback = voice('Fred', 'en-US', true, true);

  it('retries once with the best local voice, the default first', () => {
    const { speech, synth } = fakeSynth([google, plain, fallback]);
    const onEnd = vi.fn();
    speech.speak('A paper map', 'en-US', onEnd);
    expect(synth.queue[0]?.voice).toBe(google);
    synth.start();
    synth.fail('network');
    expect(onEnd).not.toHaveBeenCalled();
    expect(speech.speaking()).toBe(true);
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(synth.queue[0]).toMatchObject({ text: 'A paper map', lang: 'en-US', voice: fallback });
    synth.start();
    synth.end();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('only once: a failing retry ends it', () => {
    const { speech, synth } = fakeSynth([google, plain]);
    const onEnd = vi.fn();
    speech.speak('map', 'en-US', onEnd);
    synth.start();
    synth.fail('network');
    synth.start();
    synth.fail('synthesis-failed');
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledWith(true);
    expect(speech.speaking()).toBe(false);
  });

  it('no retry for a local voice, for speech cut off, or with no local voice', () => {
    for (const [voices, error] of [
      [[plain], 'network'],
      [[google, plain], 'interrupted'],
      [[google, plain], 'canceled'],
      [[google], 'network'],
    ] as const) {
      const { speech, synth } = fakeSynth([...voices]);
      const onEnd = vi.fn();
      speech.speak('map', 'en-US', onEnd);
      synth.start();
      synth.fail(error);
      expect(synth.speak).toHaveBeenCalledOnce();
      expect(onEnd).toHaveBeenCalledOnce();
      // Cut off is over, not failed.
      expect(onEnd).toHaveBeenCalledWith(error === 'network');
    }
  });

  it('no voice picked for the language (the browser chose): an error just ends it', () => {
    const { speech, synth } = fakeSynth([voice('Thomas', 'fr-FR')]);
    const onEnd = vi.fn();
    speech.speak('map', 'en-US', onEnd);
    synth.start();
    expect(() => synth.fail('network')).not.toThrow();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('stopped before it failed: nothing is retried', () => {
    const { speech, synth } = fakeSynth([google, plain]);
    const onEnd = vi.fn();
    speech.speak('map', 'en-US', onEnd);
    synth.start();
    // The page queued speech behind ours: stop only marks ours stopped, and it fails later.
    synth.pending = true;
    speech.stop();
    synth.fail('network');
    expect(synth.speak).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('Chrome stalls on an online voice spoken right after cancel', () => {
  const google = voice('Google UK English Female', 'en-GB', false);
  const daniel = voice('Daniel', 'en-GB');

  it('waits SETTLE_MS after its own cancel before speaking the next, shown as speaking', () => {
    vi.useFakeTimers();
    const { synth, speech } = fakeSynth([google, daniel]);
    speech.speak('map', 'en-GB', () => {});
    synth.start();
    const onEnd = vi.fn();
    speech.speak('map', 'en-US', onEnd);
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(synth.speak).toHaveBeenCalledOnce();
    expect(speech.speaking()).toBe(true);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(synth.speak).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(synth.queue).toEqual([expect.objectContaining({ lang: 'en-US' })]);
    synth.start();
    synth.end();
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it('stopped while settling: never spoken', () => {
    vi.useFakeTimers();
    const { synth, speech } = fakeSynth([google]);
    speech.speak('map', 'en-GB', () => {});
    synth.start();
    const onEnd = vi.fn();
    speech.speak('map', 'en-GB', onEnd);
    speech.stop();
    expect(speech.speaking()).toBe(false);
    vi.advanceTimersByTime(START_TIMEOUT_MS * 2);
    expect(synth.speak).toHaveBeenCalledOnce();
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('a quick second click cancels the first still queued with only ours: read once', () => {
    vi.useFakeTimers();
    const { synth, speech } = fakeSynth([google]);
    speech.speak('map', 'en-GB', () => {});
    // Not started yet (an online voice takes a moment): ours alone in the queue.
    speech.speak('map', 'en-US', () => {});
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(synth.queue).toHaveLength(0);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(synth.queue).toEqual([expect.objectContaining({ lang: 'en-US' })]);
  });

  it('never started with only ours queued: cancelled, then read with the local voice', () => {
    vi.useFakeTimers();
    const { synth, speech } = fakeSynth([google, daniel]);
    const onEnd = vi.fn();
    speech.speak('map', 'en-GB', onEnd);
    vi.advanceTimersByTime(START_TIMEOUT_MS - 1);
    expect(synth.cancel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(speech.speaking()).toBe(true);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(synth.queue[0]?.voice).toBe(daniel);
    synth.start();
    synth.end();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it('the second attempt stalling too, or no local voice: given up as failed', () => {
    vi.useFakeTimers();
    for (const voices of [[google, daniel], [google], [daniel], []]) {
      const { synth, speech } = fakeSynth(voices);
      const onEnd = vi.fn();
      speech.speak('map', 'en-GB', onEnd);
      vi.advanceTimersByTime((START_TIMEOUT_MS + SETTLE_MS) * 2);
      // At most two attempts in all; only an online voice gets the second.
      expect(synth.speak).toHaveBeenCalledTimes(voices.length === 2 ? 2 : 1);
      expect(onEnd).toHaveBeenCalledOnce();
      expect(onEnd).toHaveBeenCalledWith(true);
      expect(speech.speaking()).toBe(false);
    }
  });

  it('the page’s speech ahead of ours: waits for it, never cancels', () => {
    vi.useFakeTimers();
    const { synth, speech } = fakeSynth([google, daniel]);
    synth.speaking = true;
    const onEnd = vi.fn();
    speech.speak('map', 'en-GB', onEnd);
    vi.advanceTimersByTime(START_TIMEOUT_MS * 5);
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(speech.speaking()).toBe(true);
    // Its turn comes at last.
    synth.start();
    synth.end();
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it('stuck behind ours: a new reading cancels it rather than queueing behind it', () => {
    vi.useFakeTimers();
    const { synth, speech } = fakeSynth([google]);
    speech.speak('map', 'en-GB', () => {});
    // Chrome reports it speaking though it never starts.
    synth.speaking = true;
    speech.stop();
    expect(synth.cancel).toHaveBeenCalledOnce();
    speech.speak('road', 'en-GB', () => {});
    vi.advanceTimersByTime(SETTLE_MS);
    expect(synth.queue).toEqual([expect.objectContaining({ text: 'road' })]);
  });

  it('started but never ended: given up after its length limit, not as a failure', () => {
    vi.useFakeTimers();
    for (const pending of [false, true]) {
      const { synth, speech } = fakeSynth([daniel]);
      const onEnd = vi.fn();
      speech.speak('map', 'en-GB', onEnd);
      synth.start();
      vi.advanceTimersByTime(speakingLimit('map') - 1);
      expect(onEnd).not.toHaveBeenCalled();
      // The page queued speech behind ours meanwhile: that is left alone.
      synth.pending = pending;
      vi.advanceTimersByTime(1);
      expect(onEnd).toHaveBeenCalledWith(false);
      expect(speech.speaking()).toBe(false);
      expect(synth.cancel).toHaveBeenCalledTimes(pending ? 0 : 1);
      expect(synth.speak).toHaveBeenCalledOnce();
    }
  });

  it('each word the voice reports pushes the length limit back', () => {
    vi.useFakeTimers();
    const text = 'A paper map never tells you where to go.';
    const { synth, speech } = fakeSynth([daniel]);
    const onEnd = vi.fn();
    speech.speak(text, 'en-GB', onEnd);
    synth.start();
    vi.advanceTimersByTime(speakingLimit(text) - 100);
    synth.queue[0]?.onboundary?.({ charIndex: 30 });
    vi.advanceTimersByTime(speakingLimit(text.slice(30)) - 1);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it('the length limit: a base, more per character for CJK, at most a minute', () => {
    expect(speakingLimit('map')).toBe(4000 + 3 * 120);
    expect(speakingLimit('地图')).toBe(4000 + 6 * 120);
    expect(speakingLimit('x'.repeat(2000))).toBe(60_000);
  });

  it('a normal reading sets off no watchdog and cancels nothing', () => {
    vi.useFakeTimers();
    const { synth, speech } = fakeSynth([google, daniel]);
    const onEnd = vi.fn();
    speech.speak('map', 'en-GB', onEnd);
    vi.advanceTimersByTime(1200);
    synth.start();
    vi.advanceTimersByTime(2500);
    synth.end();
    vi.advanceTimersByTime(120_000);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
