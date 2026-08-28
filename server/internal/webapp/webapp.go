// Package webapp embeds the built frontend (app/dist, per the M10-follow-up
// deployment decision: one binary serves both the PWA and the API, no CORS
// needed in production) and serves it as a single-page app.
//
// dist/ here is NOT app/dist/ directly — go:embed cannot reach outside its
// containing package directory (the same constraint already noted for
// server/internal/db/migrations). It's populated by copying app/dist/'s
// build output in here before `go build` — see scripts/build-embedded.sh.
// Only a placeholder (.gitkeep) is committed, so a plain `go build`/`go
// test` from a fresh clone — the two independent projects' own promise —
// never requires a frontend build first; this package's Handler just serves
// nothing useful (a 404) until the real dist/ is populated.
package webapp

import (
	"bytes"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// Handler serves the embedded frontend build: a real file if the request
// path matches one, otherwise index.html — the standard SPA fallback so a
// hard refresh on a client-side route (e.g. /session/5) still works. The
// caller is responsible for mounting this only under paths /api/* and
// /healthz don't already claim.
//
// apiToken is injected into every served index.html as
// `window.__ANYWAY_CONFIG__` (see app/src/lib/runtimeConfig.ts) rather than
// baked into the frontend bundle at build time — deliberately, so the
// token can be supplied purely as a runtime environment variable
// (ANYWAY_API_TOKEN, the same one BearerAuth checks incoming requests
// against) on any host, with no dependence on a hosting platform's
// dashboard supporting custom Docker build arguments. Discovered mid-
// deployment that not all of them do — see memory.md.
func Handler(apiToken string) http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		// Only possible if the embed directive itself is wrong — a build-
		// time programming error, not a runtime condition to recover from.
		panic(err)
	}
	return handlerFor(sub, apiToken)
}

// handlerFor is Handler's actual logic, taking the root fs.FS as a
// parameter so webapp_test.go can exercise real SPA-routing behavior
// against an in-memory fstest.MapFS — this package's own embedded dist/
// only ever has the committed .gitkeep placeholder (see the package doc),
// which isn't enough to test the fallback against real content.
func handlerFor(sub fs.FS, apiToken string) http.Handler {
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		// index.html always goes through serveIndex (for the config
		// injection below), whether reached explicitly, as "/", or as the
		// SPA fallback for an unmatched client-side route — never through
		// fileServer directly.
		if path != "" && path != "index.html" {
			if f, err := sub.Open(path); err == nil {
				f.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// "/" itself, an explicit /index.html, or no real file at this path
		// (e.g. /session/5, or dist/ isn't populated at all yet) — serve
		// index.html directly, the client-side router's job from there.
		//
		// Deliberately NOT "rewrite r.URL.Path to /index.html and hand back
		// to fileServer": http.FileServer redirects any *explicit*
		// /index.html reference back to "/" (its own duplicate-content
		// guard), which would bounce every unmatched route in a 301 loop
		// back to "/" instead of actually serving the app shell there.
		serveIndex(w, r, sub, apiToken)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, sub fs.FS, apiToken string) {
	f, err := sub.Open("index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	raw, err := io.ReadAll(f)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(injectConfig(raw, apiToken))
}

// injectConfig writes window.__ANYWAY_CONFIG__ into index.html right before
// </head> — the frontend's own bundle script tag lives in <body>, so this
// always runs first (see app/src/lib/runtimeConfig.ts for the read side).
// %q quotes and escapes apiToken as a JS string literal.
func injectConfig(html []byte, apiToken string) []byte {
	tag := fmt.Sprintf(`<script>window.__ANYWAY_CONFIG__ = { apiToken: %q };</script></head>`, apiToken)
	if out := bytes.Replace(html, []byte("</head>"), []byte(tag), 1); !bytes.Equal(out, html) {
		return out
	}
	// No </head> found (e.g. this repo's own placeholder index.html, if it
	// ever has one, or a malformed build) — serve the page unmodified
	// rather than silently dropping content or erroring.
	return html
}
