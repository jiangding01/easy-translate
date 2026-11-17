import { describe, expect, it } from 'vitest';
import { isEchoedTranslation } from './echo';

const ZH = { source: 'auto', target: 'zh-CN' } as const;

const SOP_SOURCE =
  'Should I use chat or an SOP? Use chat to explore and iterate; Main Bot can still open a PR. Once you find a way of working you want every requirement to follow, with fixed reviewers, tests and sign-off, put it in an SOP. Main Bot can start, pause and take over SOP runs, so the two paths work together.';
const SOP_ECHOED =
  '我应该使用聊天还是 SOP？使用聊天来探索和迭代；主机器人仍然可以打开 PR。 Once you find a way of working you want every requirement to follow, with fixed reviewers, tests and sign-off, put it in an SOP. Main Bot can start, pause and take over SOP runs, so the two paths work together.';
const SOP_TRANSLATED =
  '我应该使用聊天还是 SOP？使用聊天来探索和迭代；主机器人仍然可以打开 PR。一旦你找到了希望每个需求都遵循的工作方式（固定的审阅者、测试和签核），就把它放进 SOP。主机器人可以启动、暂停和接管 SOP 运行，因此两条路径可以协同工作。';

const DIFY_SOURCE =
  'How is this different from Dify, n8n or Flowise? Those are general-purpose AI and automation workflow builders. LoopForge is built for software delivery with coding agents: implementer and reviewer roles, Docker sandboxes with real repositories, GitHub delivery, human acceptance gates and run evidence.';
const DIFY_ECHOED =
  'How is this different from Dify, n8n or Flowise? Those are general-purpose AI and automation workflow builders. LoopF​​orge 专为使用编码代理进行软件交付而构建：实施者和审阅者角色、具有真实存储库的 Docker 沙箱、GitHub 交付、人工验收门和运行证据。';
const DIFY_TRANSLATED =
  '这与 Dify、n8n 或 Flowise 有何不同？它们是通用的 AI 和自动化工作流构建器。LoopF​​orge 专为使用编码代理进行软件交付而构建：实施者和审阅者角色、具有真实存储库的 Docker 沙箱、GitHub 交付、人工验收门和运行证据。';

describe('isEchoedTranslation', () => {
  it('flags the real samples where Google left sentences in English', () => {
    expect(isEchoedTranslation(SOP_SOURCE, SOP_ECHOED, ZH)).toBe(true);
    expect(isEchoedTranslation(DIFY_SOURCE, DIFY_ECHOED, ZH)).toBe(true);
  });

  it('accepts complete translations of the same texts', () => {
    expect(isEchoedTranslation(SOP_SOURCE, SOP_TRANSLATED, ZH)).toBe(false);
    expect(isEchoedTranslation(DIFY_SOURCE, DIFY_TRANSLATED, ZH)).toBe(false);
  });

  it('accepts translations that only keep product names and short phrases', () => {
    expect(
      isEchoedTranslation(
        'Install LoopForge Desktop on macOS. It works with GitHub Actions.',
        '在 macOS 上安装 LoopForge Desktop。它适用于 GitHub Actions。',
        ZH,
      ),
    ).toBe(false);
    // A title made of names only is kept as is by any engine.
    expect(
      isEchoedTranslation(
        'Visual Studio Code Remote Development',
        'Visual Studio Code Remote Development',
        ZH,
      ),
    ).toBe(false);
    // Too short to tell an echo from a phrase kept on purpose.
    expect(isEchoedTranslation('Sign in to continue', 'Sign in to continue', ZH)).toBe(false);
  });

  it('ignores URLs, e-mail addresses and code-like text', () => {
    const url = 'See https://github.com/example/loop-forge-runner/blob/main/docs/getting-started';
    expect(
      isEchoedTranslation(
        url,
        '参见 https://github.com/example/loop-forge-runner/blob/main/docs/getting-started',
        ZH,
      ),
    ).toBe(false);
    expect(
      isEchoedTranslation(
        'Write to support.team@example.com',
        '写信至 support.team@example.com',
        ZH,
      ),
    ).toBe(false);
    const code = 'const value = await fetchData(url, options); return value';
    expect(isEchoedTranslation(code, code, ZH)).toBe(false);
  });

  it('sees through inline tags and zero-width characters', () => {
    const source =
      'Read the <t0>guide</t0> first. Once you find a way of working, put it in an <t1>SOP</t1>.';
    const echoed =
      '先阅读<t0>指南</t0>。 Once you find a way of​ working, put it in an <t1>SOP</t1>.';
    expect(isEchoedTranslation(source, echoed, ZH)).toBe(true);
    // Tags moved around the words still count as the same sentence.
    const moved = '先阅读<t0>指南</t0>。Once you <t1>find</t1> a way of working, put it in an SOP';
    expect(isEchoedTranslation(source, moved, ZH)).toBe(true);
    expect(
      isEchoedTranslation(
        source,
        '先阅读<t0>指南</t0>。找到工作方式后，把它放进<t1>SOP</t1>。',
        ZH,
      ),
    ).toBe(false);
  });

  it('never flags when the target is the known source language or uses Latin script', () => {
    // A different known source language is still checked.
    expect(isEchoedTranslation(SOP_SOURCE, SOP_ECHOED, { source: 'ja', target: 'zh-CN' })).toBe(
      true,
    );
    expect(isEchoedTranslation(SOP_SOURCE, SOP_SOURCE, { source: 'en', target: 'en' })).toBe(false);
    expect(
      isEchoedTranslation(DIFY_SOURCE, DIFY_ECHOED, { source: 'zh-CN', target: 'zh-TW' }),
    ).toBe(false);
    expect(isEchoedTranslation(SOP_SOURCE, SOP_SOURCE, { source: 'auto', target: 'en' })).toBe(
      false,
    );
  });

  it('is false for an empty translation', () => {
    expect(isEchoedTranslation(SOP_SOURCE, '​ ', ZH)).toBe(false);
  });
});
