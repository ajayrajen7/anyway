// Package api wires the HTTP surface described in docs/architecture.md §B5.
// /healthz and GET /api/exercises (M1) are real; every other /api/* route is
// a stub returning 501 until its milestone lands, so the frontend can be
// pointed at a live server from day one without lying about what works.
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/ajayrajen7/anyway/server/internal/dayplan"
	"github.com/ajayrajen7/anyway/server/internal/export"
	"github.com/ajayrajen7/anyway/server/internal/phase"
	"github.com/ajayrajen7/anyway/server/internal/seed"
	syncpkg "github.com/ajayrajen7/anyway/server/internal/sync"
	"github.com/ajayrajen7/anyway/server/internal/today"
)

// exerciseGenerator is the one method this package needs from
// *exercisegen.Client — narrowed to a local interface (rather than
// importing that package's concrete type) so api_test.go can pass nil or a
// fake instead of making a real LLM call. See postGenerateExercise.
type exerciseGenerator interface {
	Generate(ctx context.Context, name, notes string) (seed.Exercise, error)
}

// NewRouter's return type is chi.Router, not just http.Handler, so
// cmd/server can call .NotFound() on it to mount the embedded frontend
// (internal/webapp) as the SPA fallback for everything /api/* and /healthz
// don't claim — kept out of this package entirely, since the JSON API
// surface has no reason to know a frontend exists. chi.Router still
// satisfies http.Handler, so nothing here or in tests changes.
func NewRouter(conn *sql.DB, token string, gen exerciseGenerator) chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	r.Get("/healthz", healthz(conn))

	r.Route("/api", func(r chi.Router) {
		r.Use(BearerAuth(token))
		r.Get("/today", getToday(conn))
		r.Post("/sessions/{id}/sets", postLogSet(conn))
		// Never implemented — deliberately, not a gap. The client's data
		// model has no create-then-patch flow for a set: SessionRunner logs
		// each commit as one complete logged_sets row via a single
		// `logged_set` outbox entity (see src/lib/outbox.ts#logSet); a skip
		// is just status:'skipped' on that same write, never a separate
		// PATCH. See memory.md (M9).
		r.Post("/sessions/{id}/sets/{sid}/skip", notImplemented)
		// Never implemented — deliberately. Swap/add-exercise bookkeeping
		// (SessionOverlay) is local-only per M5's own design: it exists to
		// reconstruct *this session's* runner slots offline, and every set
		// actually logged against a swapped/added exercise already carries
		// its own provenance in the synced logged_sets row. There is
		// nothing server-side for this route to persist. See memory.md (M9).
		r.Post("/sessions/{id}/add", notImplemented)
		r.Post("/sessions/{id}/complete", postCompleteSession(conn))
		// A deliberate, narrow read path back out of logged_sets — the one
		// exception to this server's otherwise write-only relationship with
		// that table (see syncpkg.ListSetsForSession's doc). Exists purely
		// so a client whose local copy of a session's detail has gone
		// missing (a separate iOS "Add to Home Screen" storage container,
		// cleared site data, a reinstalled PWA — see memory.md's "session
		// data lost" entry) can reconstruct it, rather than that detail
		// being permanently gone even though the server has every set the
		// client ever successfully synced. The client only ever calls this
		// as a best-effort background merge (src/lib/outbox.ts#hydrateSessionFromServer),
		// never on the live set-logging path — B6.1's "session runner never
		// awaits a network call" is about *logging*, not this after-the-fact
		// recovery read.
		r.Get("/sessions/{id}/sets", getSessionSets(conn))
		r.Get("/exercises", listExercises(conn))
		// Real-time LLM-drafted exercise creation — the one deliberate
		// online-only step in this otherwise offline-first app. See
		// exercisegen's doc comment and memory.md's "real-time exercise
		// creation" decision.
		r.Post("/exercises/generate", postGenerateExercise(conn, gen))
		r.Get("/programme", getProgramme(conn)) // M8 amendment to §B5 — see memory.md
		r.Post("/morning-check", postMorningCheck(conn))
		r.Post("/protein", postProtein(conn))
		// UX refactor: a daily step count, alongside protein — see memory.md.
		r.Post("/steps", postSteps(conn))
		// Not in §B5's original list — a gap noted in M7's memory.md (the
		// client has logged mobility since M7 with nowhere real to sync it
		// to). Added here in M9 alongside the rest of the sync surface.
		r.Post("/mobility", postMobility(conn))
		r.Post("/cardio", postCardio(conn))
		// Post-M12 UX addition: "skip this day," a real distinct state — see
		// server/internal/sync#DaySkip and memory.md.
		r.Post("/day-skip", postDaySkip(conn))
		// Post-M12 UX addition: swap which day's prescription two dates use
		// this week — see server/internal/dayplan and memory.md.
		r.Post("/day-swaps", postDaySwap(conn))
		r.Delete("/day-swaps/{date}", deleteDaySwap(conn))
		r.Get("/day-swaps", getDaySwaps(conn))
		// Still a stub: its M8 precondition (server-side "actual" data
		// existing) is technically satisfied now that /api/sync writes
		// logged_sets/morning_checks, but the Week View already computes
		// both prescribed *and* actual coverage client-side from Dexie
		// (src/lib/week.ts) and works fully offline. Rebuilding it against a
		// new server aggregate would duplicate working, tested logic for no
		// user-facing benefit — out of v1 scope. See memory.md (M9).
		r.Get("/week", notImplemented)
		r.Post("/sync", postSync(conn))
		r.Get("/export", getExport(conn)) // M10 — full JSON dump of every table
	})

	return r
}

// corsMiddleware lets a browser-based frontend served from a different
// origin than this API call it at all — B1's frontend/backend split
// (Vite dev server on one port, the Go binary on another, per the README's
// own quick start) is exactly a cross-origin setup, and without this a
// browser blocks every request with no server-side error to even see.
// Auth here is a single static bearer token attached explicitly by the
// calling JS, not ambient cookie authority, so a wildcard origin doesn't
// change who can actually use the API — anyone with the token could already
// call it directly (curl, another server) regardless of what CORS allows a
// *browser* to read.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == http.MethodOptions {
			// A CORS preflight never carries the real Authorization header,
			// so it must be answered here, before BearerAuth ever sees it —
			// this middleware runs on the outer router, ahead of /api's own
			// auth-gated sub-router.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func healthz(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := conn.PingContext(r.Context()); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"status": "db unreachable"})
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}

// listExercises implements GET /api/exercises?q=&include_blocked=1
// (docs/architecture.md §B5). Excludes blocked exercises unless
// include_blocked=1 is passed — prd.md §A3.4 needs that for the swap sheet's
// "explain, don't hide" search.
func listExercises(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("q")
		includeBlocked := r.URL.Query().Get("include_blocked") == "1"

		exercises, err := seed.List(r.Context(), conn, query, includeBlocked)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		if exercises == nil {
			exercises = []seed.Exercise{} // never null in the response
		}
		json.NewEncoder(w).Encode(exercises)
	}
}

// postGenerateExercise implements POST /api/exercises/generate — the one
// online-only step in an otherwise offline-first app (see exercisegen's
// doc comment). Body: {"name": "...", "notes": "..."} (notes optional).
// The drafted record is validated (exercisegen.Generate already runs it
// through seed.ValidateExercise) and inserted via seed.InsertOne, which
// never overwrites an existing exercise — a colliding slug is deduped, not
// clobbered. gen may be nil (ANTHROPIC_API_KEY not configured, or a plain
// api.NewRouter(conn, token, nil) caller) — this is a 501, not a fatal
// server error, same "this feature degrades, not the app" shape as
// backup.OffBoxCopy being nil until wired up.
func postGenerateExercise(conn *sql.DB, gen exerciseGenerator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if gen == nil {
			writeJSONError(w, http.StatusNotImplemented, errors.New("exercise generation is not configured (ANTHROPIC_API_KEY unset)"))
			return
		}
		var body struct {
			Name  string `json:"name"`
			Notes string `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		drafted, err := gen.Generate(r.Context(), body.Name, body.Notes)
		if err != nil {
			// Bad input, an LLM-side failure, or a validation rejection are
			// all "the request couldn't be fulfilled", not a server bug —
			// 502 rather than 500, so the client can tell this apart from
			// an actual internal error.
			writeJSONError(w, http.StatusBadGateway, err)
			return
		}
		inserted, err := seed.InsertOne(r.Context(), conn, drafted)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		if inserted.Muscles == nil {
			inserted.Muscles = map[string]float64{}
		}
		json.NewEncoder(w).Encode(inserted)
	}
}

// getToday implements GET /api/today?date=YYYY-MM-DD (docs/architecture.md
// §B5; M3). `date` is the client's *local* calendar day — the server has no
// reliable way to know the user's timezone otherwise — and defaults to the
// server's own local date only as a convenience for manual/curl testing.
// This `date` param is an addition to §B5's prose, logged in memory.md.
func getToday(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		date := r.URL.Query().Get("date")
		if date == "" {
			date = time.Now().Format("2006-01-02")
		}

		resp, err := today.Get(r.Context(), conn, date)
		if err != nil {
			switch {
			case errors.Is(err, today.ErrInvalidDate):
				w.WriteHeader(http.StatusBadRequest)
			case errors.Is(err, today.ErrNoActivePhase), errors.Is(err, today.ErrNoDayTemplate):
				w.WriteHeader(http.StatusNotFound)
			default:
				w.WriteHeader(http.StatusInternalServerError)
			}
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(resp)
	}
}

// getProgramme implements GET /api/programme (M8, not in §B5's original
// list — see memory.md): the active phase's full week structure, cached
// client-side so the Week View can compute prescribed coverage offline.
func getProgramme(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp, err := phase.Get(r.Context(), conn)
		if err != nil {
			if errors.Is(err, phase.ErrNoActivePhase) {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusInternalServerError)
			}
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(resp)
	}
}

func notImplemented(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNotImplemented)
	json.NewEncoder(w).Encode(map[string]string{"error": "not implemented yet — see docs/implementation-plan.md"})
}

// writeJSONError is the shared error-body shape every handler below uses.
func writeJSONError(w http.ResponseWriter, status int, err error) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

// pathInt64 parses a chi URL param as an int64, or answers 400 and reports
// (via the bool) that the caller should stop.
func pathInt64(w http.ResponseWriter, r *http.Request, param string) (int64, bool) {
	v, err := strconv.ParseInt(chi.URLParam(r, param), 10, 64)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return 0, false
	}
	return v, true
}

// --- M9: sync surface (outbox drain) ---
//
// Every handler below is the receiving side of exactly one outbox entity
// (see app/src/lib/outbox.ts, dailyLogs.ts, morningCheck.ts) and
// is also reachable directly at its own §B5 route for parity with the spec
// and manual/curl testing — but the frontend never calls these directly; it
// always goes through POST /api/sync, which dispatches the same
// server/internal/sync functions from a batched outbox payload. See
// memory.md (M9).

// postLogSet implements POST /api/sessions/:id/sets. The path's :id is the
// authority for session_id — a session_id in the body, if present, is
// ignored, since this route's whole point (unlike /api/sync's own payload)
// is that the URL already names the session.
func postLogSet(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID, ok := pathInt64(w, r, "id")
		if !ok {
			return
		}
		var p syncpkg.SetPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		p.SessionID = sessionID
		if err := syncpkg.LogSet(r.Context(), conn, p); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func postCompleteSession(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID, ok := pathInt64(w, r, "id")
		if !ok {
			return
		}
		var p syncpkg.CompletePayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		p.SessionID = sessionID
		if err := syncpkg.CompleteSession(r.Context(), conn, p); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// getSessionSets implements GET /api/sessions/:id/sets — see the route
// comment and syncpkg.ListSetsForSession's doc for why this one read path
// exists. Always 200s with an (possibly empty) array, even for a session id
// that doesn't exist — the client only ever uses this to fill in gaps in
// its own local copy, so "nothing to add" and "no such session" look the
// same to it and need no separate handling.
func getSessionSets(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID, ok := pathInt64(w, r, "id")
		if !ok {
			return
		}
		sets, err := syncpkg.ListSetsForSession(r.Context(), conn, sessionID)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"sets": sets})
	}
}

func postMorningCheck(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var p syncpkg.MorningCheckPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		if err := syncpkg.MorningCheck(r.Context(), conn, p); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func postProtein(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var p syncpkg.ProteinPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		if err := syncpkg.Protein(r.Context(), conn, p); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func postMobility(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var p syncpkg.MobilityPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		if err := syncpkg.Mobility(r.Context(), conn, p); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func postCardio(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var p syncpkg.CardioPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		if err := syncpkg.Cardio(r.Context(), conn, p); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func postSteps(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var p syncpkg.StepsPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		if err := syncpkg.Steps(r.Context(), conn, p); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func postDaySkip(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var p syncpkg.DaySkipPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		if err := syncpkg.DaySkip(r.Context(), conn, p); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// postDaySwap implements POST /api/day-swaps — body {"date_a":"...","date_b":"..."}.
// 409 (not 400/500) when either date has an already-active session
// (completed, or with logged sets) — a real, expected refusal (see
// dayplan.ErrAlreadyStarted's own doc), not a bug. A bare, untouched
// 'planned' stub (created merely by viewing the day) does not trigger this.
func postDaySwap(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			DateA string `json:"date_a"`
			DateB string `json:"date_b"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		if err := dayplan.Swap(r.Context(), conn, body.DateA, body.DateB); err != nil {
			if errors.Is(err, dayplan.ErrAlreadyStarted) {
				writeJSONError(w, http.StatusConflict, err)
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// deleteDaySwap implements DELETE /api/day-swaps/:date — un-swaps date (and
// its partner). A no-op, not an error, if date isn't currently swapped.
func deleteDaySwap(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		date := chi.URLParam(r, "date")
		if err := dayplan.Unswap(r.Context(), conn, date); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// getDaySwaps implements GET /api/day-swaps?start=&end= — every swap pair
// touching that date range, so Week Plan can render "swapped with <day>"
// tags across whichever week it's showing.
func getDaySwaps(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := r.URL.Query().Get("start")
		end := r.URL.Query().Get("end")
		pairs, err := dayplan.ListInRange(r.Context(), conn, start, end)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"pairs": pairs})
	}
}

// postSync implements POST /api/sync — the batched outbox drain (§B5). The
// body is a JSON array of {entity, entity_id, payload}; the response is a
// same-length array of {entity, entity_id, ok, error?} the client uses to
// decide which local outbox rows to mark synced. One bad entry never fails
// the whole batch — see syncpkg.Drain.
func postSync(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var entries []syncpkg.Entry
		if err := json.NewDecoder(r.Body).Decode(&entries); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		results := syncpkg.Drain(r.Context(), conn, entries)
		json.NewEncoder(w).Encode(results)
	}
}

// getExport implements GET /api/export (M10) — a full JSON dump of every
// table, for the user's own portability/backup.
func getExport(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dump, err := export.Build(r.Context(), conn, time.Now())
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		json.NewEncoder(w).Encode(dump)
	}
}
