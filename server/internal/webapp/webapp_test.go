package webapp

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

// An in-memory frontend build, standing in for a real `npm run build`
// output — this package's own embedded dist/ only ever has the committed
// .gitkeep placeholder (see the package doc comment), so testing real
// SPA-routing behavior needs its own fixture content via handlerFor.
func fakeFrontend() fstest.MapFS {
	return fstest.MapFS{
		"index.html":           &fstest.MapFile{Data: []byte("<html>the app shell</html>")},
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
	h := handlerFor(fakeFrontend())
	rec := get(t, h, "/assets/app.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Body.String() != "console.log('hi')" {
		t.Fatalf("expected the real file's content, got %q", rec.Body.String())
	}
}

func TestRootServesIndexHtmlWithNoRedirect(t *testing.T) {
	h := handlerFor(fakeFrontend())
	rec := get(t, h, "/")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for /, got %d (Location: %s)", rec.Code, rec.Header().Get("Location"))
	}
	if rec.Body.String() != "<html>the app shell</html>" {
		t.Fatalf("expected the app shell, got %q", rec.Body.String())
	}
}

func TestUnmatchedClientSideRouteFallsBackToIndexHtmlWithNoRedirect(t *testing.T) {
	// A hard refresh on /session/5 (a route react-router owns, not a real
	// file) must serve the same app shell as "/", directly — not a 301
	// bouncing the browser back to "/" and losing the route. http.FileServer
	// has exactly this redirect quirk for an *explicit* /index.html
	// reference, which is why handlerFor never hands one to it.
	h := handlerFor(fakeFrontend())
	for _, path := range []string{"/session/5", "/week", "/weigh"} {
		rec := get(t, h, path)
		if rec.Code != http.StatusOK {
			t.Fatalf("path %s: expected 200 (app shell, no redirect), got %d (Location: %s)", path, rec.Code, rec.Header().Get("Location"))
		}
		if rec.Body.String() != "<html>the app shell</html>" {
			t.Fatalf("path %s: expected the app shell, got %q", path, rec.Body.String())
		}
	}
}

func TestNoIndexHtmlAtAllIsA404NotAPanic(t *testing.T) {
	// The real state of this package's committed dist/ (just .gitkeep) —
	// Handler() itself must degrade to a plain 404, never crash the server.
	h := handlerFor(fstest.MapFS{".gitkeep": &fstest.MapFile{}})
	rec := get(t, h, "/")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 with no index.html embedded at all, got %d", rec.Code)
	}
}

func TestHandlerBuildsFromTheRealEmbeddedFS(t *testing.T) {
	// Smoke test for Handler() itself (not handlerFor) — proves the
	// fs.Sub(distFS, "dist") wiring is correct against whatever's actually
	// embedded right now (just .gitkeep in this repo).
	rec := get(t, Handler(), "/.gitkeep")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for a file that actually exists in the embedded FS, got %d", rec.Code)
	}
}
