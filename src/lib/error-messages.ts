import type { AppError } from '@/lib/errors';

// Stable error codes → user-facing copy. The future i18n layer replaces this table.
const MESSAGES: Record<string, string> = {
  'config/newer-version': '设置由更新版本的扩展写入，当前版本无法修改。请更新扩展。',
  'config/write-failed': '保存失败，请重试。',
  'config/read-failed': '读取设置失败，请刷新后重试。',
  'network/extension-unreachable': '无法连接扩展后台，请重新加载扩展后重试。',
  'network/page-unreachable': '无法连接页面，请刷新网页后重试。Chrome 商店等受限页面无法使用。',
  'validation/unsupported-page': '请在普通 HTTP 或 HTTPS 网页中打开插件。',
};

export function describeError(error: AppError, fallback = '操作失败，请重试。'): string {
  return MESSAGES[error.code] ?? fallback;
}
