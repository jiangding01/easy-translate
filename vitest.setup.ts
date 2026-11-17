import { beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createGetMessage, loadLocales } from './scripts/i18n-messages.mjs';

// fake-browser has no i18n.getMessage. Tests read the zh_CN copy (missing keys fall back to
// en, unknown keys throw), from the same files and conversion as the build. Set at top level,
// not only in beforeEach: module-level tables call it while test files are imported.
const getMessage = createGetMessage(await loadLocales(), 'zh_CN');
const installI18n = () => {
  fakeBrowser.i18n.getMessage = getMessage as typeof fakeBrowser.i18n.getMessage;
};
installI18n();

beforeEach(() => {
  fakeBrowser.reset();
  installI18n();
});
