import { describe, expect, it } from 'vitest';
import { appError } from '@/lib/errors';
import {
  chunkByLimits,
  decodeLlmOutput,
  encodeBatch,
  renderUserMessage,
  settleWithSplit,
  splitInHalf,
  USER_INPUT_TOKEN,
} from './codec';

describe('chunkByLimits', () => {
  it('splits by item count', () => {
    expect(chunkByLimits(['a', 'b', 'c', 'd', 'e'], { maxItems: 2, maxChars: 100 })).toEqual([
      [0, 1],
      [2, 3],
      [4],
    ]);
  });

  it('splits by character count', () => {
    expect(chunkByLimits(['aaa', 'bbb', 'cc'], { maxItems: 10, maxChars: 6 })).toEqual([
      [0, 1],
      [2],
    ]);
  });

  it('puts an oversized item alone without splitting it', () => {
    const groups = chunkByLimits(['a', 'x'.repeat(50), 'b'], { maxItems: 10, maxChars: 10 });
    expect(groups).toEqual([[0], [1], [2]]);
  });
});

describe('encode / decode', () => {
  it('encodes items with positional ids', () => {
    expect(JSON.parse(encodeBatch(['x', 'y']))).toEqual([
      { i: 0, t: 'x' },
      { i: 1, t: 'y' },
    ]);
  });

  it('renders the template without interpreting $ patterns', () => {
    const out = renderUserMessage(`A ${USER_INPUT_TOKEN} B`, ['$&']);
    expect(out).toBe(`A ${encodeBatch(['$&'])} B`);
  });

  it('decodes plain, fenced and noisy outputs', () => {
    const json = '[{"i":0,"t":"一"},{"i":1,"t":"二"}]';
    expect(decodeLlmOutput(json, 2)).toEqual(['一', '二']);
    expect(decodeLlmOutput(`\`\`\`json\n${json}\n\`\`\``, 2)).toEqual(['一', '二']);
    expect(decodeLlmOutput(`Sure! Here you go:\n${json}\nHope it helps.`, 2)).toEqual(['一', '二']);
  });

  it('reorders out-of-order output by i', () => {
    expect(decodeLlmOutput('[{"i":1,"t":"二"},{"i":0,"t":"一"}]', 2)).toEqual(['一', '二']);
  });

  it.each([
    ['not json', 'no array here', 1],
    ['missing id', '[{"i":0,"t":"a"}]', 2],
    ['duplicate id', '[{"i":0,"t":"a"},{"i":0,"t":"b"}]', 2],
    ['out of range', '[{"i":0,"t":"a"},{"i":5,"t":"b"}]', 2],
    ['negative id', '[{"i":-1,"t":"a"}]', 1],
    ['fractional id', '[{"i":0.5,"t":"a"}]', 1],
    ['empty translation', '[{"i":0,"t":"  "}]', 1],
    ['non-string text', '[{"i":0,"t":1}]', 1],
    ['non-object item', '["a"]', 1],
    ['extra item', '[{"i":0,"t":"a"},{"i":1,"t":"b"}]', 1],
  ])('rejects %s', (_name, raw, count) => {
    expect(() => decodeLlmOutput(raw, count)).toThrow(
      expect.objectContaining({ code: 'validation/bad-response' }),
    );
  });
});

describe('splitInHalf / settleWithSplit', () => {
  it('splits down to single items and refuses to split further', () => {
    expect(splitInHalf([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(splitInHalf([1])).toBeUndefined();
  });

  it('halves a malformed batch until only the bad item fails', async () => {
    const calls: number[][] = [];
    const outcomes = await settleWithSplit([1, 2, 3, 4], async (items) => {
      calls.push([...items]);
      if (items.includes(3)) throw appError('validation', 'validation/bad-response', 'bad');
      return items.map((n) => `t${n}`);
    });
    expect(outcomes.map((o) => (o.ok ? o.text : o.error.code))).toEqual([
      't1',
      't2',
      'validation/bad-response',
      't4',
    ]);
    expect(calls).toEqual([[1, 2, 3, 4], [1, 2], [3, 4], [3], [4]]);
  });

  it('treats a wrong result length as malformed', async () => {
    const outcomes = await settleWithSplit(['a', 'b'], async (items) =>
      items.length === 2 ? ['only one'] : items.map((s) => s.toUpperCase()),
    );
    expect(outcomes).toEqual([
      { ok: true, text: 'A' },
      { ok: true, text: 'B' },
    ]);
  });

  it('does not split on other errors', async () => {
    let calls = 0;
    const outcomes = await settleWithSplit([1, 2], async () => {
      calls += 1;
      throw appError('provider', 'provider/unauthorized', 'no');
    });
    expect(calls).toBe(1);
    expect(outcomes.every((o) => !o.ok && o.error.code === 'provider/unauthorized')).toBe(true);
  });
});

describe('decodeLlmOutput: raw JSON first', () => {
  it('parses a valid array whose translation contains a code fence', () => {
    const raw = JSON.stringify([{ i: 0, t: 'Use ```[1, 2]``` here' }]);
    expect(decodeLlmOutput(raw, 1)).toEqual(['Use ```[1, 2]``` here']);
  });

  it('still reads fenced and noisy outputs', () => {
    expect(decodeLlmOutput('```json\n[{"i":0,"t":"a"}]\n```', 1)).toEqual(['a']);
    expect(decodeLlmOutput('Sure: [{"i":0,"t":"a"}] done', 1)).toEqual(['a']);
  });
});

describe('settleWithSplit: truncated and blocked batches', () => {
  it.each(['provider/output-truncated', 'provider/content-blocked'] as const)(
    'halves on %s and ends single items with the real code',
    async (code) => {
      const calls: number[][] = [];
      const outcomes = await settleWithSplit([1, 2, 3, 4], async (items) => {
        calls.push([...items]);
        if (items.includes(3)) throw appError('provider', code, 'x');
        return items.map(String);
      });
      expect(outcomes).toEqual([
        { ok: true, text: '1' },
        { ok: true, text: '2' },
        { ok: false, error: expect.objectContaining({ code }) },
        { ok: true, text: '4' },
      ]);
      expect(calls).toEqual([[1, 2, 3, 4], [1, 2], [3, 4], [3], [4]]);
    },
  );
});
