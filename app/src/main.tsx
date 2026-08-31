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

// The generated service worker (vite.config.ts's registerType: 'autoUpdate')
// calls skipWaiting+clientsClaim, so a new deploy activates in the
// background as soon as the browser next fetches sw.js — but the already-
// open tab keeps running on the OLD cached assets until *something* reloads
// it; without this listener that meant every deploy needed two manual
// reloads to actually show up (confirmed live: several real deploys this
// session appeared to "not have happened" for exactly this reason). This
// reloads automatically the moment a new service worker takes control.
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return; // a controllerchange can fire more than once
    reloading = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
