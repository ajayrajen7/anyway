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
// background as soon as the browser next fetches sw.js. vite-plugin-pwa's
// auto-injected registerSW.js only ever checks for one, once, on the very
// first page load — nothing after that asks again, and real-world testing
// on this session found the app could sit on a stale deploy indefinitely
// on a phone (iOS Safari in particular doesn't reliably re-check a service
// worker on its own). Force a real check every time the app comes back
// into the foreground — reopening a pinned tab, switching back from
// another app — so a deploy made while it was in the background is at
// least *detected* the next time it's actually used, not whenever the
// browser's own opportunistic timing happens to notice.
// registration.update() is a safe no-op if nothing's changed.
//
// What happens once an update IS detected lives in UpdateBanner.tsx, not
// here: an earlier version of this code reloaded the page automatically
// the moment a new service worker took control, which silently destroyed
// in-progress, not-yet-committed data (a set's weight/reps stepper is only
// local React state until the checkmark is tapped) — reported live. The
// banner puts the reload under the user's own control instead.
if ('serviceWorker' in navigator) {
  const checkForUpdate = () => {
    navigator.serviceWorker.getRegistration().then((reg) => reg?.update());
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('focus', checkForUpdate);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
