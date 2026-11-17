import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeech, pickVoice, type SynthLike, VOICES_WAIT_MS } from './speech';

interface FakeUtterance {
  text: string;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
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
      }) as unknown as SpeechSynthesisUtterance,
  });
  return { synth, speech };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('speech (plan 4.5 rule 4)', () => {
  it('reads the source with the detected language, or none', () => {
    const { synth, speech } = fakeSynth();
    speech.speak('A paper map', 'en', () => {});
    expect(synth.queue[0]).toMatchObject({ text: 'A paper map', lang: 'en' });
    speech.speak('map', undefined, () => {});
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
    const { synth, speech } = fakeSynth();
    const onEnd = vi.fn();
    speech.speak('mine', 'en', onEnd);
    synth.start();
    expect(speech.speaking()).toBe(true);
    speech.stop();
    expect(synth.cancel).toHaveBeenCalledOnce();
    speech.speak('again', 'en', onEnd);
    synth.start();
    synth.end();
    expect(onEnd).toHaveBeenCalledOnce();
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
    const enhanced = voice('Ava (Enhanced)', 'en-US');
    const { speech, synth } = fakeSynth([voice('Samantha', 'en-US'), enhanced]);
    speech.speak('A paper map', 'en', () => {});
    expect((synth.queue[0] as unknown as { voice?: unknown }).voice).toBe(enhanced);
    speech.speak('map', undefined, () => {});
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
