import type { AppError } from '@/lib/errors';

// Error copy for content scripts. The full table (lib/error-messages) stays out of the
// content bundles (scripts/check-build.mjs): errors from the background arrive with
// `userMessage` already attached; only the errors the content side makes itself are
// looked up here. Same wording as the full table. Callers render it as text.

const LOCAL: Record<string, string> = {
  'network/page-unreachable': '无法连接页面，请刷新网页后重试。Chrome 商店等受限页面无法使用。',
  'validation/bad-response': '翻译服务返回的内容无法解析。请重试，或换一个翻译服务。',
};

export function errorText(error: AppError): string {
  return error.userMessage ?? LOCAL[error.code] ?? '操作失败，请重试。';
}
