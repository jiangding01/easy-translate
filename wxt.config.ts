import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  webExt: { disabled: true },
  manifest: {
    name: 'Easy Translate',
    description: '网页翻译工具，TypeScript 重构开发版。',
    permissions: ['storage', 'activeTab'],
    host_permissions: [
      'https://translate.googleapis.com/*',
      'https://api.openai.com/*',
      'https://api.deepseek.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    action: { default_title: 'Easy Translate' },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
