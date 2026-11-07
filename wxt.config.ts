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
    action: { default_title: 'Easy Translate' },
    icons: {
      16: 'icon/16.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
