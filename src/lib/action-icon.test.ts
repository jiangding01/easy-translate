import { describe, expect, it, vi } from 'vitest';
import { createActionIcon, type IconImages } from './action-icon';

function setup() {
  const draw = vi.fn(async (status: string) => ({ status }) as unknown as IconImages);
  const setIcon = vi.fn(async (_details: { tabId: number; imageData: IconImages }) => {});
  return { icon: createActionIcon({ draw, setIcon }), draw, setIcon };
}

describe('action icon', () => {
  it('draws each status once and skips repeats per tab', async () => {
    const { icon, draw, setIcon } = setup();
    await icon.show(1, 'running');
    await icon.show(1, 'running');
    await icon.show(2, 'running');
    await icon.show(1, 'error');
    expect(draw.mock.calls.map(([status]) => status)).toEqual(['running', 'error']);
    expect(setIcon).toHaveBeenCalledTimes(3);
  });

  it('does nothing for an idle tab and clears a dot on navigation', async () => {
    const { icon, setIcon } = setup();
    await icon.show(1, 'idle');
    await icon.reset(1);
    expect(setIcon).not.toHaveBeenCalled();
    await icon.show(1, 'done');
    await icon.reset(1);
    expect(setIcon.mock.calls.at(-1)?.[0]).toMatchObject({
      tabId: 1,
      imageData: { status: 'idle' },
    });
  });

  it('retries after a failed draw or a closed tab', async () => {
    const { icon, draw, setIcon } = setup();
    draw.mockRejectedValueOnce(new Error('no canvas'));
    await icon.show(1, 'running');
    await icon.show(1, 'running');
    expect(draw).toHaveBeenCalledTimes(2);
    expect(setIcon).toHaveBeenCalledTimes(1);
    icon.forget(1);
    await icon.show(1, 'running');
    expect(setIcon).toHaveBeenCalledTimes(2);
  });
});
