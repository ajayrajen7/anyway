# Library Drawers and Exercise Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse Library muscle groups by default and let the owner archive any exercise without damaging programme or workout history.

**Architecture:** Add a server-owned `active` flag and an idempotent archive endpoint. Keep archived rows and muscle data in the full client cache for historical calculations, while filtering inactive entries from the Library and new exercise choices. Keep the Library sections collapsed by default and require an online, confirmed archive action.

**Tech Stack:** React 19, TypeScript, Dexie, Vitest/Testing Library, Go, chi, SQLite.

**Spec:** `docs/superpowers/specs/2026-10-06-library-drawers-and-exercise-archive-design.md`

## Global Constraints

- Any of the existing seeded or LLM-created exercises can be archived.
- Archive is online-only; do not add offline archive queueing or recovery.
- Archive preserves exercise rows, muscle weights, programme slots, slot swaps, logged sets, session snapshots, and their IDs.
- The Library and future search/slot-swap choices exclude archived exercises, including approved options in older cached session snapshots.
- An in-flight full-library refresh cannot reactivate a locally archived exercise.
- Every muscle group is collapsed on first render; its Add action remains visible and independent.
- No new dependency, archive-restore UI, automatic deduplication, or programme editing.

## Review Focus

- **Curated exercise reseed:** an archived seeded record stays archived after `seed.Apply`; pin with `TestApplyPreservesArchivedState` in Task 1.
- **Referenced programme/history record:** archival leaves joined Today data, logs, and coverage details intact; pin DB/reference integrity in `TestArchiveExercise` in Task 1 and frontend cache retention in Task 2.
- **Approved swap referencing archived exercise:** exclude the archived option while retaining the slot; pin with `TestArchivedExerciseIsOmittedFromSwaps` in Task 1.
- **Exercise cross-listed into multiple groups:** successful archive removes it from every group; pin with `removesCrossListedExerciseFromAllExpandedGroups` in Task 3.
- **Old local cache and archive failure:** treat missing `active` as active, and do not hide a row after offline/API failure; pin with `offlineSearchTreatsMissingActiveAsActive` in Task 2 and `archiveFailureKeepsExerciseVisible` in Task 3.

## File Map

- `server/internal/db/migrations/0013_exercises_active.sql` — additive active flag.
- `server/internal/seed/seed.go` — active field, archive mutation, active/archive-aware catalogue listing, reseed behavior.
- `server/internal/seed/seed_test.go` — persistence/listing/reseed/reference tests.
- `server/internal/api/api.go` and `api_test.go` — archive HTTP route and status handling.
- `server/internal/today/today.go` and `today_test.go` — omit archived entries from approved swap choices.
- `app/src/lib/types.ts` — optional `Exercise.active` for old local cache compatibility.
- `app/src/lib/api.ts` — full-cache listing and archive request.
- `app/src/lib/api.test.ts` — archive request method/path/success/error behavior.
- `app/src/lib/exerciseCache.ts` and `exerciseCache.test.ts` — retain archived details in Dexie, preserve archive state across stale refreshes, and filter them from search.
- `app/src/routes/Library.tsx` and `Library.test.tsx` — disclosure drawers, confirmation, online action, pending/error/success states.
- `app/src/routes/SwapSheet.tsx` and `SessionFlows.test.tsx` — filter archived choices from approved options held in cached session snapshots.
- `docs/prd.md`, `docs/architecture.md`, `docs/implementation-plan.md`, `memory.md`, `CLAUDE.md` — canonical behavior and project checkpoint/index.

### Task 1: Persist and serve archived exercises safely

**Files:**
- Create: `server/internal/db/migrations/0013_exercises_active.sql`
- Modify: `server/internal/seed/seed.go`
- Test: `server/internal/seed/seed_test.go`
- Modify: `server/internal/api/api.go`
- Test: `server/internal/api/api_test.go`
- Modify: `server/internal/today/today.go`
- Test: `server/internal/today/today_test.go`

**Interfaces:**
- Produce `seed.ErrNotFound` for an unknown exercise ID.
- Produce `seed.Archive(ctx context.Context, conn *sql.DB, id int64) error`; return `ErrNotFound` if no row exists and leave related rows untouched.
- Extend `seed.Exercise` with `Active bool` (`json:"active"`).
- Extend `seed.List(ctx, conn, query, includeBlocked, includeArchived)` with a final `includeArchived bool`; only return inactive rows when it is true. With no archived flag, preserve active-only results.
- Add authenticated `DELETE /api/exercises/{id}`: 204 on archive (including an already-archived row), 404 for an unknown ID, and 400 for a non-positive/non-integer path ID.
- Add `include_archived=1` for the complete cache read; all other catalogue reads omit inactive rows.
- Ensure `seed.InsertOne` returns newly generated exercises with `Active: true`; new rows use the database default.

- [ ] **Step 1: Write failing seed tests** named `TestArchiveExercise`, `TestArchiveUnknownExercise`, `TestListExcludesArchivedByDefault`, `TestListCanIncludeArchived`, `TestApplyPreservesArchivedState`, and `TestInsertOneStartsActive`. Assert archive changes only `active`, preserves `exercise_muscles` and references, default listing excludes inactive rows, explicit inclusion returns them, reseeding does not reactivate, and new records start active.
- [ ] **Step 2: Run the focused seed tests and confirm they fail** with the missing active/archive behavior.

Run: `go test ./internal/seed -run 'Test(Archive|ApplyPreservesArchivedState|List|InsertOneStartsActive)' -count=1`

Expected: FAIL because the migration, active-aware API, and archive mutation do not exist yet.

- [ ] **Step 3: Add migration and seed behavior.** Add `active INTEGER NOT NULL DEFAULT 1`; scan it into `Exercise`; omit `active` from the seed upsert's update clause so curated reseeds do not reactivate archived rows; implement `Archive` and active/archive-aware `List`.
- [ ] **Step 4: Run focused seed tests and confirm they pass.**

Run: `go test ./internal/seed -run 'Test(Archive|ApplyPreservesArchivedState|List|InsertOneStartsActive)' -count=1`

Expected: PASS.

- [ ] **Step 5: Write failing API and Today tests** for 204/404/invalid ID, active-only listing plus explicit archived cache listing, an archived prescribed slot still resolving, and an archived approved swap being omitted.
- [ ] **Step 6: Run focused API and Today tests and confirm they fail.**

Run: `go test ./internal/api ./internal/today -run 'Test(Archive|ArchivedExercise)' -count=1`

Expected: FAIL because route/listing/swap filtering are not implemented.

- [ ] **Step 7: Implement the HTTP route and filtering.** Wire the authenticated DELETE handler and `include_archived=1`; filter `slot_swaps` by active state without filtering prescribed `slots`.
- [ ] **Step 8: Run focused API and Today tests and confirm they pass.**

Run: `go test ./internal/api ./internal/today -run 'Test(Archive|ArchivedExercise)' -count=1`

Expected: PASS.

- [ ] **Step 9: Run all backend checks.**

Run: `go test ./... && go vet ./... && go build ./...`

Expected: all commands succeed.

### Task 2: Preserve archive state in the client cache, filter new choices

**Files:**
- Modify: `app/src/lib/types.ts`
- Modify: `app/src/lib/api.ts`
- Modify: `app/src/lib/exerciseCache.ts`
- Test: `app/src/lib/exerciseCache.test.ts`

**Interfaces:**
- `Exercise.active?: boolean`; treat `undefined` as active for existing Dexie rows.
- `archiveExercise(id: number): Promise<void>` sends `DELETE /api/exercises/:id` and resolves only on successful response.
- `getExerciseLibrary()` fetches blocked and archived rows for the complete cache; `cacheExerciseLibrary()` retains the active value and muscle metadata for archived rows.
- `searchExercisesOffline(query, includeBlocked)` excludes `active === false`, while retaining current blocked filtering and search ordering.

- [ ] **Step 1: Write failing client tests** named `cacheExerciseLibraryRetainsArchivedDetails`, `offlineSearchExcludesArchivedExercises`, `offlineSearchTreatsMissingActiveAsActive`, `archiveExerciseSendsDeleteRequest`, and `archiveExerciseRejectsServerError`. Assert the cache retains inactive rows and their muscle weights, search ignores only explicit `active: false`, and archive sends DELETE to the exercise ID and rejects failed HTTP responses.
- [ ] **Step 2: Run focused frontend tests and confirm they fail.**

Run: `npm test -- src/lib/exerciseCache.test.ts src/lib/api.test.ts`

Expected: FAIL because cache responses do not request/archive active state and search does not filter it.

- [ ] **Step 3: Add the optional client field, archive API wrapper, and cache/search behavior.** Parse `active` when present; keep old cached objects valid; fetch the full archive-aware catalogue for cache retention.
- [ ] **Step 4: Run focused frontend tests and confirm they pass.**

Run: `npm test -- src/lib/exerciseCache.test.ts src/lib/api.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the full frontend suite before committing this task.**

Run: `npm test`

Expected: all frontend tests pass.

### Task 3: Add Library disclosure groups and confirmed archive action

**Files:**
- Modify: `app/src/routes/Library.tsx`
- Test: `app/src/routes/Library.test.tsx`
- Modify: `docs/prd.md`
- Modify: `docs/architecture.md`
- Modify: `docs/implementation-plan.md`
- Modify: `CLAUDE.md`
- Modify: `memory.md`

**Interfaces:**
- Library state tracks expanded group IDs independently from the currently open Add form.
- Group labels are disclosure buttons with `aria-expanded` and `aria-controls`; initialize expanded IDs as an empty set.
- Archive uses `archiveExercise(id)` then stores `active: false` in Dexie and component state. Do not update local data until the server confirms success.

- [ ] **Step 1: Write failing Library tests** named `startsWithEveryMuscleGroupCollapsed`, `expandsOnlyTheSelectedGroup`, `addActionIsVisibleAndIndependentOfDisclosure`, `cancelledArchiveKeepsExercise`, `archivesCrossListedExerciseFromEveryGroup`, `archiveRequiresConnection`, and `archiveFailureKeepsExerciseVisible`. Assert the confirmation copy, `aria-expanded`, active group counts, and that the API is not called on cancel/offline.
- [ ] **Step 2: Run the focused Library suite and confirm the new cases fail.**

Run: `npm test -- src/routes/Library.test.tsx`

Expected: new behavior assertions fail against the current always-expanded, non-archivable Library.

- [ ] **Step 3: Implement the disclosure UI and online archive flow.** On Add, expand the target group to expose the form; keep Add separate from the disclosure button. Before archiving, confirm the catalogue-only effect; disable duplicate requests, then mark the cached and displayed row inactive after success. Show an inline `role="alert"` error and preserve the row after failure or loss of connectivity. Filter inactive rows out when deriving groups; old cached rows with no `active` field remain visible.
- [ ] **Step 4: Run Library tests and confirm they pass.**

Run: `npm test -- src/routes/Library.test.tsx`

Expected: PASS.

- [ ] **Step 5: Update canonical product and architecture docs** to describe collapsed groups, active-only catalogue/search behavior, online archival, cache retention, and unchanged direct programme/history references. Record implementation status and the next task in `memory.md`.
- [ ] **Step 6: Run frontend checks.**

Run: `npm run typecheck && npm run lint && npm test && npm run build`

Expected: all commands succeed.

## Final Review

- Confirm collapsed groups and Add actions at mobile width; only the selected group reveals its list.
- Confirm archive state persists after an online Library refresh and does not hide the same exercise from existing programme/session references or Coverage calculations.
- Review `git diff` against the approved spec; do not add restore UI, offline queueing, hard deletion, or automatic duplicate merging.
