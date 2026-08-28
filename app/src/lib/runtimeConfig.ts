// Reads the API token from wherever it's actually available.
//
// Local dev (`npm run dev`): Vite bakes `VITE_API_TOKEN` from
// app/.env.local in at build time, same as always.
//
// Production (the embedded single-binary deploy, M10-follow-up): the Go
// server injects `window.__ANYWAY_CONFIG__` into index.html at serve time
// (see server/internal/webapp#injectConfig), from its own ANYWAY_API_TOKEN
// environment variable. This exists because not every hosting platform's
// dashboard supports passing custom Docker build arguments (discovered
// when Render's didn't) — a runtime env var is something literally every
// host supports, so the token no longer needs to be baked into the
// frontend bundle at all.
declare global {
  interface Window {
    __ANYWAY_CONFIG__?: { apiToken: string };
  }
}

export function getApiToken(): string {
  return window.__ANYWAY_CONFIG__?.apiToken ?? import.meta.env.VITE_API_TOKEN ?? '';
}
