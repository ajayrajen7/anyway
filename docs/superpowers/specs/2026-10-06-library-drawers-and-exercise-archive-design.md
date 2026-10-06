# Library Drawers and Exercise Archive — Design

**Status:** Approved for implementation; owner waived plan review
**Date:** 2026-10-06  
**Repository:** `ajayrajen7/anyway`, `main`

## Agreed outcome

Improve the existing Library tab in two ways:

1. Keep every muscle group collapsed by default. Tapping a group reveals its exercises, avoiding a long page of expanded exercise cards.
2. Let the owner remove any exercise from the active catalogue, regardless of whether it came from the programme seed or the LLM generator.

The owner confirmed that removal applies to all exercises and that gym connectivity is available. This design therefore makes archive actions online-only; it does not add offline deletion or recovery.

## Approaches considered

### Archive the catalogue entry (recommended)

Set an `active` flag to false and exclude archived exercises from Library groups, broad exercise search, and slot-swap choices. Keep the database row and its muscle weights so programme slots, workout history, and Coverage remain valid. This supports removing any exercise without destructive cascades or a per-exercise reference check.

### Permanently delete only unreferenced entries

Check all foreign-key references and physically delete an exercise only when none exist. Referenced exercises would have to be rejected, so the requested remove action would not work consistently for every exercise.

### Permanently delete with cascades

Delete or rewrite programme slots, approved swaps, logged sets, and related muscle rows. This can erase training history or change the prescribed plan and is outside the requested cleanup.

## User interaction

- Render each of the five existing muscle groups as a disclosure control, collapsed on first render. The group label, active exercise count, and chevron remain visible. Activating the group toggles its exercise panel; use native button semantics and expose expanded state to assistive technology.
- Keep the `+ Add` action visible beside each group and independent of the disclosure control, so opening the generator does not accidentally toggle the panel.
- Add a `Remove` action to each exercise card. Because an exercise can appear in more than one group, removal updates the shared exercise record and removes it from every expanded group at once.
- Before the server mutation, ask for confirmation and explain that the exercise will leave the Library and future search choices while existing plans and history remain intact.
- Require a connection for removal. While the request is in flight, prevent duplicate submissions. On success, update the local cache and visible groups. On failure, leave the exercise visible and show an actionable error.

## Archive behavior and data flow

- Add `exercises.active INTEGER NOT NULL DEFAULT 1` in a new SQLite migration. Existing rows remain active by default.
- Add an idempotent authenticated `DELETE /api/exercises/{id}` operation that sets `active = 0` and returns success for an existing row. Unknown IDs return not found. The handler never deletes or rewrites related rows.
- The ordinary Library and picker catalogue only returns active exercises. Approved swap lists omit archived entries, including options already present in a cached session snapshot; the Swap sheet filters those choices using the shared exercise cache without rewriting that snapshot. Offline search excludes archived exercises.
- Keep archived exercise data available in the client's exercise cache because Coverage and historical/session recovery use exercise details. The complete cache refresh includes archived rows and their `active` value; cache writes preserve any locally archived status so an older in-flight response cannot reactivate a row. User-facing catalogue views filter archived rows out. Treat a missing `active` value in a pre-migration client cache as active for compatibility.
- Re-seeding an existing curated exercise updates its seed-owned fields but preserves its current `active` state. A newly inserted exercise starts active through the database default.
- Archiving does not edit existing `slots`, `slot_swaps`, `logged_sets`, session snapshots, or their exercise IDs. A currently prescribed programme slot can therefore still render its exercise after that exercise has been archived from the general catalogue. This preserves the programme and history; archive is catalogue removal, not programme editing.
- Exercise generation remains unchanged and creates active entries. Blocked exercises retain their current safety treatment; archiving is an additional way to remove entries from normal browsing/search.

## Scope and documentation

Expected implementation areas:

- `app/src/routes/Library.tsx` and `Library.test.tsx` for collapsed sections, confirmation, removal state, online state, and errors.
- `app/src/lib/types.ts`, `exerciseCache.ts`, and relevant picker code for the archive status and active-only selection.
- `server/internal/db/migrations/`, `seed/`, `api/`, and `today/` for persistence, API behavior, filtering, and swap choices.
- `docs/prd.md`, `docs/architecture.md`, `docs/implementation-plan.md`, and `memory.md` for canonical product behavior and the checkpoint.

Out of scope: permanently deleting exercise records; changing programme prescriptions; changing session-level exercise removal; building archive restore UI; offline archive queuing; editing exercise metadata; and deduplicating records automatically.

## Acceptance criteria

- All five Library groups start collapsed. Expanding one shows only that group's exercises; closing it hides them again.
- The group count represents active catalogue exercises. The Add action remains reachable while a group is collapsed.
- Any exercise can be archived after confirmation, including programme-sourced and LLM-sourced entries. A cancelled confirmation changes nothing.
- A successful archive removes that exercise from every Library group and future active search/swap choices, online and from the cache after refresh.
- Existing programme/session references and coverage calculations retain the exercise details and behave as before.
- A failed or unavailable archive request does not hide the exercise and presents an error.
- Seed reapplication does not silently reactivate an archived curated exercise.

## Self-review

- **Scope:** one existing Library flow plus the minimum server/cache path required for persistent removal; no new exercise-management screen.
- **Data integrity:** existing foreign-key relationships remain untouched. The distinction between catalogue removal and changing a programme slot is explicit.
- **Compatibility:** old cached exercise objects without `active` remain visible and selectable until refreshed; migrated server records default active.
- **Consistency:** archive filtering applies to the Library and new catalogue/search choices, while direct references in programme slots and session history remain usable.
- **Open decision:** none for this design. The owner approved archival for all exercises and confirmed connectivity is available in the gym.
