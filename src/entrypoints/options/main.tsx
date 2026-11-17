import '@/styles/tokens.css';
import '@/styles/base.css';
import { createRoot } from 'react-dom/client';
import { applyUiLocale } from '@/lib/ui-locale';
import { App } from './App';

applyUiLocale(document);
const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');
createRoot(container).render(<App />);
