import type { AppError } from '@/lib/errors';
import { message, type NoArgKey } from './i18n';

// Error copy for content scripts. The full table (lib/error-messages) stays out of the
// content bundles (scripts/check-build.mjs): errors from the background arrive with
// `userMessage` already attached; only the errors the content side makes itself are
// looked up here, under the same keys as the full table. Callers render it as text.
// Key table only at top level: the copy is looked up per call (docs/plans/i18n.md 4.2).

const LOCAL: Record<string, NoArgKey> = {
  'network/page-unreachable': 'errors.network.pageUnreachable',
  'validation/bad-response': 'errors.validation.badResponse',
};

export function errorText(error: AppError): string {
  if (error.userMessage !== undefined) return error.userMessage;
  return message(LOCAL[error.code] ?? 'errors.generic');
}
