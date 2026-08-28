package webapp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// An in-memory frontend build, standing in for a real `npm run build`
// output — this package's own embedded dist/ only ever has the committed
// .gitkeep placeholder (see the package doc comment), so testing real
// SPA-routing behavior needs its own fixture content via handlerFor. A
// real </head> is needed here (unlike a bare "<html>...") so
// injectConfig's insertion point actually exists, matching a real Vite
// build's output.
func fakeFrontend() fstest.MapFS {
	return fstest.MapFS{
		"index.html":           &fstest.MapFile{Data: []byte("<html><head></head><body>the app shell</body></html>")},
		"assets/app.js":        &fstest.MapFile{Data: []byte("console.log('hi')")},
		"manifest.webmanifest": &fstest.MapFile{Data: []byte("{}")},
	}
}

func get(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestServesARealFileDirectly(t *testing.T) {
	h := handlerFor(fakeFrontend(), "test-token")
	rec := get(t, h, "/assets/app.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Body.String() != "console.log('hi')" {
		t.Fatalf("expected the real file's content, unmodified — no config injection outside index.html — got %q", rec.Body.String())
	}
}

func TestRootServesIndexHtmlWithNoRedirect(t *testing.T) {
	h := handlerFor(fakeFrontend(), "test-token")
	rec := get(t, h, "/")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for /, got %d (Location: %s)", rec.Code, rec.Header().Get("Location"))
	}
	if !strings.Contains(rec.Body.String(), "the app shell") {
		t.Fatalf("expected the app shell, got %q", rec.Body.String())
	}
}

func TestUnmatchedClientSideRouteFallsBackToIndexHtmlWithNoRedirect(t *testing.T) {
	// A hard refresh on /session/5 (a route react-router owns, not a real
	// file) must serve the same app shell as "/", directly — not a 301
	// bouncing the browser back to "/" and losing the route. http.FileServer
	// has exactly this redirect quirk for an *explicit* /index.html
	// reference, which is why handlerFor never hands one to it.
	h := handlerFor(fakeFrontend(), "test-token")
	for _, path := range []string{"/session/5", "/week", "/weigh"} {
		rec := get(t, h, path)
		if rec.Code != http.StatusOK {
			t.Fatalf("path %s: expected 200 (app shell, no redirect), got %d (Location: %s)", path, rec.Code, rec.Header().Get("Location"))
		}
		if !strings.Contains(rec.Body.String(), "the app shell") {
			t.Fatalf("path %s: expected the app shell, got %q", path, rec.Body.String())
		}
	}
}

func TestIndexHtmlGetsTheApiTokenInjected(t *testing.T) {
	// The whole point of the runtime-injection approach (see the package
	// doc comment): the deployed server's own ANYWAY_API_TOKEN must reach
	// the frontend without ever having been baked into the build.
	h := handlerFor(fakeFrontend(), "super-secret-token")
	for _, path := range []string{"/", "/index.html", "/session/5"} {
		rec := get(t, h, path)
		body := rec.Body.String()
		if !strings.Contains(body, `window.__ANYWAY_CONFIG__`) {
			t.Fatalf("path %s: expected the config script tag, got %q", path, body)
		}
		if !strings.Contains(body, "super-secret-token") {
			t.Fatalf("path %s: expected the real token value injected, got %q", path, body)
		}
	}
}

func TestOtherFilesAreNeverInjected(t *testing.T) {
	// Only index.html gets the config script — a real asset (JS, the PWA
	// manifest, ...) must come back byte-for-byte, or Workbox's precache
	// manifest hashes would mismatch what's actually served.
	h := handlerFor(fakeFrontend(), "super-secret-token")
	rec := get(t, h, "/manifest.webmanifest")
	if rec.Body.String() != "{}" {
		t.Fatalf("expected the manifest untouched, got %q", rec.Body.String())
	}
}

func TestNoIndexHtmlAtAllIsA404NotAPanic(t *testing.T) {
	// The real state of this package's committed dist/ (just .gitkeep) —
	// Handler() itself must degrade to a plain 404, never crash the server.
	h := handlerFor(fstest.MapFS{".gitkeep": &fstest.MapFile{}}, "test-token")
	rec := get(t, h, "/")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 with no index.html embedded at all, got %d", rec.Code)
	}
}

func TestHandlerBuildsFromTheRealEmbeddedFS(t *testing.T) {
	// Smoke test for Handler() itself (not handlerFor) — proves the
	// fs.Sub(distFS, "dist") wiring is correct against whatever's actually
	// embedded right now (just .gitkeep in this repo).
	rec := get(t, Handler("test-token"), "/.gitkeep")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for a file that actually exists in the embedded FS, got %d", rec.Code)
	}
}
