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
	"embed"
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
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		// Only possible if the embed directive itself is wrong — a build-
		// time programming error, not a runtime condition to recover from.
		panic(err)
	}
	return handlerFor(sub)
}

// handlerFor is Handler's actual logic, taking the root fs.FS as a
// parameter so webapp_test.go can exercise real SPA-routing behavior
// against an in-memory fstest.MapFS — this package's own embedded dist/
// only ever has the committed .gitkeep placeholder (see the package doc),
// which isn't enough to test the fallback against real content.
func handlerFor(sub fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if f, err := sub.Open(path); err == nil {
				f.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// "/" itself, or no real file at this path (e.g. /session/5, or
		// dist/ isn't populated at all yet) — serve index.html directly,
		// the client-side router's job from there.
		//
		// Deliberately NOT "rewrite r.URL.Path to /index.html and hand back
		// to fileServer": http.FileServer redirects any *explicit*
		// /index.html reference back to "/" (its own duplicate-content
		// guard), which would bounce every unmatched route in a 301 loop
		// back to "/" instead of actually serving the app shell there.
		serveIndex(w, r, sub)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, sub fs.FS) {
	f, err := sub.Open("index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		// Every real fs.File embed.FS hands out implements io.ReadSeeker;
		// this only guards against that assumption ever changing.
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, "index.html", stat.ModTime(), rs)
}
