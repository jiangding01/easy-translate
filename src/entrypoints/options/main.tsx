import '@/styles/tokens.css';
import '@/styles/base.css';
import { createRoot } from 'react-dom/client';
import { i18n } from '#i18n';
import { applyUiLocale } from '@/lib/ui-locale';
import { App } from './App';

applyUiLocale(document);
document.title = i18n.t('options.title');
const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');
createRoot(container).render(<App />);
