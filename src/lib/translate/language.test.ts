import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSameLanguageCheck,
  DETECT_TIMEOUT_MS,
  type DetectedLanguages,
  detectWithBrowser,
  stripForDetection,
} from './language';

const ZH = '这是一段足够长的中文文本内容';

function detector(result: DetectedLanguages) {
  return vi.fn(async (_text: string) => result);
}

const reliable = (language: string): DetectedLanguages => ({
  isReliable: true,
  languages: [{ language, percentage: 97 }],
});

afterEach(() => {
  vi.useRealTimers();
});

describe('same-language check', () => {
  it('skips when detection is reliable and matches the target', async () => {
    const check = createSameLanguageCheck(detector(reliable('zh')));
    expect(await check(ZH, 'zh-CN')).toBe(true);
  });

  it('translates when the detected language differs', async () => {
    const check = createSameLanguageCheck(detector(reliable('en')));
    expect(await check(ZH, 'zh-CN')).toBe(false);
  });

  it('translates when detection is not reliable', async () => {
    const check = createSameLanguageCheck(
      detector({ isReliable: false, languages: [{ language: 'zh', percentage: 60 }] }),
    );
    expect(await check(ZH, 'zh-CN')).toBe(false);
  });

  it('uses the language with the highest percentage', async () => {
    const check = createSameLanguageCheck(
      detector({
        isReliable: true,
        languages: [
          { language: 'en', percentage: 20 },
          { language: 'ja', percentage: 80 },
        ],
      }),
    );
    expect(await check('これは十分に長い日本語の文章です', 'ja')).toBe(true);
    expect(await check('これは十分に長い日本語の文章です', 'en')).toBe(false);
  });

  it('does not detect short texts', async () => {
    const detect = detector(reliable('zh'));
    const check = createSameLanguageCheck(detect);
    expect(await check('中文短句', 'zh-CN')).toBe(false);
    expect(detect).not.toHaveBeenCalled();
  });

  it('strips tags and placeholders before measuring and detecting', async () => {
    expect(stripForDetection('<b>你好</b>{{1}} <a href="x">世界</a> {{ 2 }}')).toBe('你好 世界');
    const detect = detector(reliable('zh'));
    const check = createSameLanguageCheck(detect);
    // Long only because of the markup: too short once stripped.
    expect(await check('<span class="highlight">中文</span>{{1}}{{2}}', 'zh-CN')).toBe(false);
    expect(detect).not.toHaveBeenCalled();
    expect(await check(`<p class="note">${ZH}</p>{{1}}`, 'zh-CN')).toBe(true);
    expect(detect).toHaveBeenCalledWith(ZH);
  });

  it('keeps Simplified and Traditional Chinese apart', async () => {
    const traditional = createSameLanguageCheck(detector(reliable('zh-Hant')));
    expect(await traditional('這是一段足夠長的繁體中文文本', 'zh-TW')).toBe(true);
    expect(await traditional('這是一段足夠長的繁體中文文本', 'zh-CN')).toBe(false);
    const simplified = createSameLanguageCheck(detector(reliable('zh-CN')));
    expect(await simplified(ZH, 'zh-TW')).toBe(false);
  });

  it('translates when the API throws or rejects', async () => {
    const throwing = createSameLanguageCheck(() => {
      throw new Error('boom');
    });
    expect(await throwing(ZH, 'zh-CN')).toBe(false);
    const rejecting = createSameLanguageCheck(async () => {
      throw new Error('boom');
    });
    expect(await rejecting(ZH, 'zh-CN')).toBe(false);
  });

  it('translates when detection is unavailable', async () => {
    expect(await createSameLanguageCheck(undefined)(ZH, 'zh-CN')).toBe(false);
    // The test browser has no working i18n.detectLanguage.
    await expect(detectWithBrowser(ZH)).rejects.toBeDefined();
    expect(await createSameLanguageCheck(detectWithBrowser)(ZH, 'zh-CN')).toBe(false);
  });

  it('gives up after the detection timeout', async () => {
    vi.useFakeTimers();
    const check = createSameLanguageCheck(() => new Promise(() => undefined));
    const result = check(ZH, 'zh-CN');
    await vi.advanceTimersByTimeAsync(DETECT_TIMEOUT_MS);
    expect(await result).toBe(false);
  });
});

describe('same-language check: dominance threshold', () => {
  it('still translates when the target language is only 51% of the text', async () => {
    const check = createSameLanguageCheck(
      detector({
        isReliable: true,
        languages: [
          { language: 'zh', percentage: 51 },
          { language: 'en', percentage: 49 },
        ],
      }),
    );
    expect(await check(`${ZH} and some English words here`, 'zh-CN')).toBe(false);
  });

  it('skips at 80% and above', async () => {
    const check = createSameLanguageCheck(
      detector({
        isReliable: true,
        languages: [
          { language: 'zh', percentage: 80 },
          { language: 'en', percentage: 20 },
        ],
      }),
    );
    expect(await check(ZH, 'zh-CN')).toBe(true);
  });
});
