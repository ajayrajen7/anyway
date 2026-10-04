# Exercise Library by Muscle Group — Implementation Plan

**Status:** Plan only; implementation has not started.
**Date:** 2026-10-04
**Design:** [Architecture](library-muscle-groups-architecture.md)

## Sequence

1. **Record the product behavior in the PRD.** Add the Library route and tab, the five proposed sections, cross-listing behavior, exercise-impact display, and online-only generation behavior. Keep this feature separate from session logging flows.
2. **Add the broad taxonomy helper.** Define the five sections and their canonical-tag membership in one frontend module. Derive each section's exercises from the existing `Exercise.muscles` map. Preserve detailed tag weights and sort names consistently.
3. **Build the Library screen.** Read cached exercises from Dexie, render all sections and matching exercises, and show the AI-estimated and blocked states with the existing labels and safety details. Keep browsing usable offline.
4. **Reuse the current generator.** Add a section-scoped form that calls `generateExercise(name, notes)`. Put the selected section and any user-supplied description into `notes`; do not change the server prompt, Anthropic client, API route, schema, or persistence path. Cache the returned exercise with `cacheExercise()` and show its returned muscle weights and safety fields.
5. **Connect navigation.** Register `/library` inside `AppShell` and add the Library item to the bottom nav. Confirm the four items fit at the app's mobile width and retain the current dark visual system.
6. **Update project records.** Add the route and user behavior to `docs/prd.md`; document the taxonomy, Dexie flow, and generator reuse in `docs/architecture.md`; add this milestone to `docs/implementation-plan.md`; record the outcome and next task in `memory.md`.
7. **Verify during implementation.** Add focused frontend coverage for complete tag mapping, cross-listing by weighted tags, offline browsing, generation context and success/error states, blocked results, and route navigation. Then run the app's documented frontend checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`). No backend changes are expected, so Go checks should only be needed if implementation uncovers an actual backend change.

## Done when

- Library is a persistent bottom-nav tab at `/library`.
- All 17 existing canonical tags map to exactly one broad section.
- Existing exercises appear under every section represented by their positive-weight tags; no weights are rewritten or aggregated.
- A new exercise created from a section calls the existing LLM endpoint, is persisted through its existing behavior, is cached immediately, and displays the returned detailed muscle impacts and safety metadata.
- Browsing works from the existing Dexie cache offline, while creation clearly requires a connection.
- Project docs and `memory.md` describe the delivered behavior and next task.

## Scope guard

Do not introduce a new LLM endpoint, model, prompt framework, persistence lifecycle, canonical tag, database field, or session-attribution flow as part of this milestone. If implementation reveals that the existing generation endpoint cannot serve the Library flow as specified, stop and revise the architecture before changing backend behavior.
