# Exercise Library by Muscle Group — Architecture

**Status:** Implemented on `docs/library-muscle-groups-plan`.
**Date:** 2026-10-04
**Repository baseline:** `ajayrajen7/anyway`, `main` as reviewed for this task.

## Goal

Add a persistent Library tab that browses the existing exercise library through a small set of broad sections. Keep the existing 17 canonical muscle tags and their per-exercise impact weights as the data source. Creating an exercise from a section reuses the existing LLM generation path and shows its returned muscle impacts.

## Taxonomy layer

The app already has a canonical vocabulary in `app/src/lib/types.ts` and readable labels in `app/src/lib/muscleLabels.ts`. Add a frontend-only mapping from broad Library sections to those canonical tags:

| Library section | Existing canonical tags |
| --- | --- |
| Chest | `chest` |
| Back | `lats`, `upper_back`, `erectors` |
| Shoulders & Arms | `delts_front`, `delts_side`, `delts_rear`, `biceps`, `triceps` |
| Legs | `quads`, `hamstrings`, `glutes`, `adductors`, `calves`, `tibialis`, `foot` |
| Core | `core` |

This keeps all 17 tags represented in five sections. The owner approved `Shoulders & Arms` so biceps and triceps have an explicit home. The mapping is UI taxonomy only; it does not rename tags or change persisted data.

An exercise appears in every section containing at least one tag with a positive weight in its existing `muscles` map. Its detailed tags and weights remain visible under the exercise name (for example, `Chest 1.0 · delts_front 0.5`). Do not combine weights into a single broad-section score: the current 1.0 / 0.5 / 0.3 values describe individual canonical tags, and aggregating them would invent a new metric.

## Navigation and data flow

- Add `/library` under the existing `AppShell` and add Library to the persistent bottom navigation.
- Read the library from the existing Dexie `db.exercises` cache immediately. When online, refresh that cache in the background through `cacheExerciseLibrary()` and then refresh the view; a failed network refresh leaves the cached list available offline.
- Each section lists matching cached exercises in a stable name order. An exercise may be shown in multiple sections, but it remains one record in Dexie and on the server.
- Put an **Add exercise** action in each section. It collects an exercise name and may accept a short description or equipment note.
- On create, call the existing `generateExercise(name, notes)` client helper and `POST /api/exercises/generate`. Include the selected broad section in `notes` as context, while asking the model to classify every materially involved canonical muscle rather than limiting the answer to that section.
- Keep the current backend/model path, validation rules, response schema, server persistence behavior, and API key handling. On success, call the existing `cacheExercise()` helper so the exercise appears immediately in the local library. No new endpoint or database field is needed.
- Render the returned individual muscle tags and weights, plus the existing pressure, impact, caution, and blocked reason fields. Mark `source: 'llm'` data as AI-estimated, consistent with the existing Add Exercise flow. Blocked entries remain visibly marked and follow the existing non-selectable safety treatment in session flows.
- If offline, browsing still works from Dexie; creation explains that a connection is required. Use the existing loading and API-error patterns.

## Boundaries

This change adds no canonical muscle tag, schema migration, seed rewrite, programme change, coverage calculation, new dependency, model, prompt, or backend endpoint. It does not change how session additions record Trainer/Mine attribution. A generated exercise continues to follow the existing endpoint's persistence behavior.

## Main files expected to change during implementation

- `app/src/App.tsx` — route.
- `app/src/components/AppShell.tsx` — Library navigation item.
- `app/src/lib/` — broad-section mapping and grouping helper.
- `app/src/routes/Library.tsx` — browsing and generation UI.
- `docs/prd.md`, `docs/architecture.md`, `docs/implementation-plan.md`, and `memory.md` — canonical project documentation and checkpoint.

## Settled product choice

The owner approved five sections and the `Shoulders & Arms` label so biceps and triceps have an explicit home.
