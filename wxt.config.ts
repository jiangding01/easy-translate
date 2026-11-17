import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  webExt: { disabled: true },
  manifest: {
    name: 'Easy Translate',
    description: '网页翻译工具，TypeScript 重构开发版。',
    permissions: ['storage', 'activeTab', 'contextMenus'],
    host_permissions: [
      'https://translate.googleapis.com/*',
      'https://api.openai.com/*',
      'https://api.deepseek.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    // Popover (114) and @starting-style (117) in the UI; 130 for dynamic-URL web
    // accessible resources (`use_dynamic_url`) that serve the on-demand page runtime.
    minimum_chrome_version: '130',
    // page-runtime.js and selection-runtime.js are imported by the content script only.
    // The dynamic URL keeps pages from fetching them by extension ID
    // (see docs/plans/m2b-lazy-runtime-and-isle.md).
    web_accessible_resources: [
      {
        resources: ['page-runtime.js'],
        matches: ['http://*/*', 'https://*/*'],
        use_dynamic_url: true,
      },
      {
        resources: ['selection-runtime.js'],
        matches: ['http://*/*', 'https://*/*'],
        use_dynamic_url: true,
      },
    ],
    action: { default_title: 'Easy Translate' },
    commands: {
      // Not Ctrl+Shift+A on Windows/Linux: Chrome's tab search owns it and the
      // declaration would silently fail. See docs/plans/m2-page-translation.md 5.1.
      'translate-page': {
        suggested_key: { default: 'Alt+A', mac: 'MacCtrl+Shift+A' },
        description: '翻译此页 / 显示原文',
      },
      // Not Alt+S: it collides with Outlook on the web (send) and MediaWiki's save access key
      // in Chrome. See docs/plans/m3a-selection.md 4.6.
      'translate-selection': {
        suggested_key: { default: 'Alt+Shift+S', mac: 'MacCtrl+Shift+S' },
        description: '翻译选中文字',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
