import type { AppError } from '@/lib/errors';

// Stable error codes → user-facing copy. The future i18n layer replaces this table.
const MESSAGES: Record<string, string> = {
  'config/newer-version': '设置由更新版本的扩展写入，当前版本无法修改。请更新扩展。',
  'config/write-failed': '保存失败，请重试。',
  'config/read-failed': '读取设置失败，请刷新后重试。',
  'network/extension-unreachable': '无法连接扩展后台，请重新加载扩展后重试。',
  'network/page-unreachable': '无法连接页面，请刷新网页后重试。Chrome 商店等受限页面无法使用。',
  'validation/payload-too-large': '一次提交的内容过多。请缩小翻译范围后重试。',
  'validation/empty-translation': '翻译服务返回了空结果。请重试，或换一个翻译服务。',
  'validation/invalid-payload': '请求格式不正确。请刷新页面后重试。',
  'validation/forbidden-sender': '该操作只能在设置页中进行。请从设置页重试。',
  'validation/invalid-secret':
    '密钥格式不正确：只能包含英文字母、数字和符号，不能有空格，且不超过 512 个字符。请重新复制后再粘贴。',
  'config/invalid-base-url':
    '接口地址不正确。请填写 https 开头的地址，本地模型可用 http://localhost。',
  'config/model-required': '尚未填写模型名称。请填写模型后重试。',
  'config/permission-missing': '尚未授权访问该接口地址。请在设置页点击「授权访问」后重试。',
  'config/provider-limit': '自定义服务已达 10 个上限。请先删除不用的服务。',
  'config/provider-missing': '找不到这个自定义服务，可能已被删除。请在设置页重新选择默认引擎。',
  'config/invalid-value': '设置值不正确，没有保存。请检查后重试。',
  'provider/unauthorized': '密钥无效或没有访问权限。请检查密钥后重试。',
  'provider/local-origin-rejected':
    '本地服务拒绝了扩展的请求。如果是 Ollama，需要把环境变量 OLLAMA_ORIGINS 设为 chrome-extension://*，再彻底退出并重新打开 Ollama。',
  'provider/not-found': '接口地址或模型不存在。请检查接口地址和模型名称。',
  'provider/quota-exceeded': '该服务的额度已用完。请充值，或换一个翻译服务。',
  'provider/server-error': '翻译服务暂时出错。请稍后重试，或换一个翻译服务。',
  'provider/output-truncated': '译文超出模型的输出长度，被截断了。请缩小翻译范围，或换一个模型。',
  'provider/content-blocked': '这段内容被翻译服务的安全策略拦截，无法翻译。',
  'rate-limit/too-many-requests': '请求过于频繁，服务暂时限流。请稍等片刻后重试。',
  'rate-limit/port-busy': '当前页面同时进行的翻译请求过多。请稍等片刻后重试。',
  'network/fetch-failed': '无法连接翻译服务。请检查网络后重试。',
  'network/timeout': '翻译服务响应超时。请检查网络后重试。',
  'network/stream-interrupted': '翻译过程中连接中断。请重试。',
  'provider/bad-request': '翻译服务拒绝了该请求。请检查模型名称等设置后重试。',
  'validation/bad-response': '翻译服务返回的内容无法解析。请重试，或换一个翻译服务。',
  'validation/unsupported-page': '请在普通 HTTP 或 HTTPS 网页中打开插件。',
};

export function describeError(error: AppError, fallback = '操作失败，请重试。'): string {
  return MESSAGES[error.code] ?? fallback;
}
