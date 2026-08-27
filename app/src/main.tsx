import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { runSync } from './lib/sync';

// M9's sync worker is foreground-only (see src/lib/sync.ts): drain the
// outbox once on app mount, and again whenever the browser regains
// connectivity. Fire-and-forget — runSync never throws.
runSync();
window.addEventListener('online', () => {
  runSync();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
