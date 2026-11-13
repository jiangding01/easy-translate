import { browser } from 'wxt/browser';

export const GET_PAGE_INFO = 'easy-translate:get-page-info';
export const GET_BACKGROUND_STATUS = 'easy-translate:get-background-status';

export interface PageInfo {
  title: string;
  language: string;
}

export function isMessage(value: unknown, type: string): boolean {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === type;
}

export async function inspectActivePage(): Promise<PageInfo> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error('请在普通 HTTP 或 HTTPS 网页中打开插件。');
  }

  let response: unknown;
  try {
    response = await browser.tabs.sendMessage(tab.id, { type: GET_PAGE_INFO }, { frameId: 0 });
  } catch {
    throw new Error('无法连接页面，请刷新网页后重试。Chrome 商店等受限页面无法使用。');
  }

  if (
    typeof response !== 'object' ||
    response === null ||
    !('title' in response) ||
    typeof response.title !== 'string' ||
    !('language' in response) ||
    typeof response.language !== 'string'
  ) {
    throw new Error('页面脚本返回了无效数据，请刷新网页后重试。');
  }
  return { title: response.title, language: response.language };
}
