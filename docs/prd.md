# PRD — Anyway (v1 scope)

> Product spec. See `vision.md` for the why, `programme.md` for the training/nutrition programme this app logs against, `architecture.md` for the build spec, `implementation-plan.md` for milestones.

# PART A — PRODUCT SPEC

## A1. What this is

A prescription-and-logging app for one user following a fixed 6-month training programme, built around three constraints that override normal fitness-app conventions:

1. **The user has a delayed, cumulative pain signal.** Deviations from the programme must be captured in a way that keeps the training input interpretable, or the whole exercise is pointless.
2. **Logging happens mid-session, one-handed, with a trainer waiting.** Any interaction costing more than ~2 seconds will be abandoned within three weeks.
3. **The user has previously quit a tracking app because outcome numbers demotivated him.** Outcome data is collected and deliberately withheld.

## A2. The user actions (everything else is support)

> **UX refactor (post-M10, see memory.md):** weight tracking and the Vault
> were dropped entirely — the owner does not want to track weight, full
> stop. This table and the sections below reflect that.

| When | Action | Interaction budget |
|---|---|---|
| Morning | Log pain level | 1 tap |
| Gym | Follow or edit today's session, log actual sets | ~1 tap per set |
| Any time | Log steps | stepper |
| Evening | Log protein hit y/n | 1 tap |
| Any time | View this week's muscle-group coverage or the week's plan | tab switch |

## A3. Screens

A persistent bottom nav (Today / Coverage / Week Plan) wraps the three
"browse any time" screens. Everything else is a full-screen flow entered
and left, not a tab.

| Route | Screen | Purpose |
|---|---|---|
| `/` | Today | Today's session card, mobility checkbox, steps, protein row (evening only) |
| `/coverage` | Coverage | Muscle-group coverage actual vs prescribed + pain strip, navigable across weeks |
| `/week` | Week Plan | Monday–Saturday, each day graded green/yellow/red, navigable across weeks |
| `/check` | Morning Check | Full-screen, 4 buttons, closes on tap |
| `/session/:id` | Exercise list | Every exercise in today's session; start from any of them, swap or delete any of them |
| `/session/:id/exercise/:key` | Exercise screen | One exercise, full screen, set logging |
| `/session/:id/exercise/:key/swap/:slotId` | Swap sheet | Approved swaps, then search |
| `/session/:id/add` | Add exercise | Search + trainer/me attribution |
| `/session/:id/done` | Session summary | Counts, volume, optional note |
| `/settings` | Settings | Programme phase, seed reset, export |

### A3.1 Morning Check (`/check`)

Fires as a local notification at **07:00 daily**, including rest days.

Full-screen card, no app chrome, no back button:

> **How are the last 24 hours?**
> `None` · `Background` · `Noticeable` · `Limiting`

On tap: persist, close the PWA window. Do **not** route to `/`.

- No history, streak, graph, or encouragement text on this screen. Ever.
- One silent re-notify at 11:00. If still unanswered by 23:59, store nothing. **An unlogged day must remain absent from the table — never default to `none`.**

### A3.2 Today (`/`)

Above the fold, one card, headed by the **weekday name** — never the phase's
own day-template name ("Lower A"/"Lower B"). The owner thinks in weekdays
day to day, not phase-day labels:

```
Thursday
7 exercises · ~55 min
[ Start session ]
```

Below: `Mobility (10 min)` checkbox, a `Steps` stepper (manual count, any
time of day). After 18:00, a `Protein — hit 120g?` row with `Yes` / `No`.

**Wed/Sat** show the weekday name and route to the light flow (A3.6).

**Missed days do not reschedule.** If Thursday's session is never started, it is marked `missed` at midnight and Friday still shows Friday's template. Do not build rescheduling — comparability across weeks is the product.

### A3.3 Exercise list (`/session/:id`)

The session's landing screen — every exercise in today's session, in
prescribed order, each showing its prescription and status (pending / in
progress / done):

```
LOWER B                                    7 exercises

[ Start ]

  Hip thrust        3 × 12          [swap] [delete]
  Leg press         3 × 10   done   [swap] [delete]
  ...

[ + Add exercise ]      [ Finish session → ]
```

- **Start from any exercise** — tapping a row opens it directly at A3.3.1. `Start` opens the first not-yet-done exercise.
- **Swap or delete any exercise**, right from this list, not just the one currently open. Delete removes the exercise from *this session's* list entirely (no sets ever logged against it) — session-local, like a swap, never edits the programme itself.
- `Finish session` is an explicit action here, not an automatic consequence of reaching the last exercise on A3.3.1.

#### A3.3.1 Exercise screen (`/session/:id/exercise/:key`)

One exercise, full screen, reached from the list above:

```
1 of 7                                   [ ← Exercises ]

HIP THRUST
Prescribed: 3 × 12 @ 20 kg
Last time:  3 × 12 @ 20 kg

  Set 1    20 kg  ×  12          [ ✓ ]
  Set 2    20 kg  ×  12          [ ✓ ]
  Set 3    20 kg  ×  12          [ ✓ ]

[ Swap ]    [ Skip ]    [ Next → ]
```

**Set rows pre-fill with the last logged actual for that exercise**, falling back to prescribed load/reps on first exposure.

Interactions:
- **Tap ✓** → set logged as-is, row greys, rest timer starts (90s default, counts up after zero). **1 tap.**
- **Tap the weight number** → inline `− 20 kg +` stepper replaces the label. Increment from `exercises.default_increment_kg` (2.5 kg dumbbells/barbell, 5 kg leg press, 1 kg for band/bodyweight-adjacent). Tap ✓ to commit. **≤3 taps.**
- **Tap the reps number** → same pattern, ±1.
- **Swipe row left** → skipped. No reason prompt in v1.
- **Next** advances to the next exercise in list order; on the last exercise it returns to the list instead — finishing the session is the list's own explicit action (A3.3).

**Hard rule: no keyboard is reachable from this screen.** No RPE, no per-set notes, no form rating.

### A3.4 Swap (`/session/:id/exercise/:key/swap/:slotId`)

Bottom sheet, two tiers:

```
Instead of HIP THRUST:

  Single-leg hip thrust
  Glute bridge (band)
  45° back extension
  ─────────────────
  Search…
```

- **Tier 1** = `slot_swaps` for this slot. Selecting one records `provenance = swap_in_list`. The substitute's own muscle weights are used (they are matched by design, so the ledger stays clean).
- **Tier 2** = full library search. Records `provenance = swap_off_list`.

No warning dialogs, no red text. A small coloured dot on the row is sufficient.

**Search must exclude contraindicated exercises** (see A5.3) but must *explain* rather than hide: matching a blocked term returns a greyed row with its reason, non-selectable.

### A3.5 Add exercise (`/session/:id/add`)

Reached from `⋯` → `Add exercise`. Search picker, then one mandatory sheet:

> **Whose call?** `Trainer` · `Mine`

Records `provenance = added`, `added_by` set. This is the single highest-value field in the app — additions are the most likely driver of flares and the least noticed. Do not make it skippable.

### A3.6 Cardio / Mobility day

```
WEDNESDAY — Mobility + Cardio

☐ Cross trainer      [ − 20 min + ]
☐ Full mobility (13 items)     [ View ]

[ Done ]
```

`View` expands a checklist of mobility items; individual ticks optional. Three taps to close the day.

### A3.7 Coverage (`/coverage`)

**UX refactor:** this used to be one screen ("Week View") that also carried
the Mon–Sat plan below it; the two are now separate bottom-nav tabs. This
tab is the muscle-load half — coverage numbers and the pain strip, still on
one screen together, still never split into further tabs of their own:

```
◀  THIS WEEK  ▶

Sets by muscle group          actual / prescribed
Quads              14 / 14    ●
Hamstrings          9 / 9     ●
Glutes             17 / 14    ▲ +21%
Calves              9 / 9     ●
Chest              11 / 11    ●
Lats               15 / 15    ●
...

Total volume       18,400 kg   (previous week: 17,900)

Mornings   ● ● ○ ● ● ● ●
```

Rules:
- **Descriptive only.** The selected week's counts, the previous week's single volume figure, the selected week's seven pain dots.
- **No correlation, no trend lines, no multi-week charts, no generated insight text.**
- The pain strip must render on the same screen as the load numbers, always, directly below them.
- `actual` sums `exercise_muscles.weight` over completed sets. `prescribed` sums the same over the day templates for that week.
- **Navigable across weeks** (◀ previous / ▶ next, capped at the current week) — the one respect in which this isn't just "this week," per the owner's explicit ask.

### A3.8 Week Plan (`/week`)

**New in the UX refactor.** Monday through Saturday (Sunday, a rest day, is
not shown here — Coverage's pain strip still covers all 7 days), each day
graded by how many of its 3 expected actions are done:

```
◀  THIS WEEK  ▶

● Monday      3 of 3
● Tuesday     2 of 3
○ Wednesday   0 of 2
...

View coverage →
```

- **Green** = all 3 done, **yellow** = 1–2 of 3, **red** = none.
- The "3" is day-appropriate: a lifting day's are the session, protein, and steps; a cardio/mobility day's are cardio+mobility (one combined item), protein, and steps.
- **Navigable across weeks**, same as Coverage.
- Descriptive only, same restraint as A3.7 — no streaks, no badges, no "you're on a 4-week streak" copy.

## A4. Weight tracking / "the Vault" — removed

This section originally specified a weigh-in flow and an 84-day server-side
lock on ever seeing that data ("the Vault"), in service of constraint #3 in
`vision.md` (outcome data collected and withheld to avoid demotivation).

**Removed entirely in the UX refactor** (post-M10, see `memory.md`): the
owner does not want weight tracked at all, full stop — not logged, not
locked, not revealed later. There is no weigh-in screen, no `weigh_ins`
table, no Vault gate anywhere in the codebase. Section numbering below (A5,
A6) is left as-is rather than renumbered, since those numbers are referenced
throughout `architecture.md`, `memory.md`, and code comments.

## A5. Exercise Library

### A5.1 Muscle groups (canonical)

`quads · hamstrings · glutes · adductors · calves · tibialis · foot · erectors · chest · lats · upper_back · delts_front · delts_side · delts_rear · biceps · triceps · core`

### A5.2 Weighting convention

Each exercise maps to 1–4 muscles with a weight:

- `1.0` — primary mover; the set fully counts
- `0.5` — strong secondary; meaningful stimulus
- `0.3` — meaningful but not stimulus-driving

A set of goblet squat therefore contributes 1.0 to quads and 0.5 to glutes. Weekly coverage is the sum of these across completed sets — which is why an untagged exercise is worse than a missing one, and why **search results cannot be saved without tags.** When an off-list exercise is picked, present suggested tags with one tap to accept.

Two additional fields drive swap safety:

- `pressure` — `low` / `moderate` / `high`. Intra-abdominal pressure. The user's primary aggravator.
- `impact` — `none` / `low` / `high`. Right knee (meniscal) and bilateral Achilles.

A valid tier-1 swap shares the primary muscle and has `pressure` no higher than the original.

### A5.3 Contraindicated (seed as blocked, with reason)

| Exercise | Reason shown |
|---|---|
| Conventional deadlift | Braced hinge — high intra-abdominal pressure |
| Barbell RDL | Braced hinge — high intra-abdominal pressure |
| Back squat (loaded) | Braced spinal loading |
| Standing barbell overhead press | Standing brace under load |
| Kettlebell swing | Braced hinge + ballistic |
| Farmer's carry (heavy) | Sustained intra-abdominal pressure |
| Hanging leg raise | High intra-abdominal pressure |
| Ab wheel rollout | High intra-abdominal pressure |
| Sit-up / crunch | Spinal flexion under pressure |
| Hollow hold | Sustained bracing |
| Box jump | Impact — knee |
| Running / skipping / burpee | Impact — knee and Achilles |

### A5.4 Seed data

Ship as `seed/exercises.json`. Schema per entry:

```json
{
  "slug": "goblet-squat",
  "name": "Goblet squat",
  "equipment": "dumbbell",
  "pressure": "moderate",
  "impact": "none",
  "unilateral": false,
  "increment_kg": 2.5,
  "muscles": { "quads": 1.0, "glutes": 0.5, "core": 0.3 }
}
```

**Full seed set (75 exercises):**

*Quad-dominant lower*

| Slug | Name | Equip | Press. | Impact | Muscles |
|---|---|---|---|---|---|
| leg-press | Leg press | machine | high | none | quads 1.0, glutes 0.5, hamstrings 0.3 |
| leg-press-sl | Single-leg leg press | machine | moderate | none | quads 1.0, glutes 0.5 |
| goblet-squat | Goblet squat | dumbbell | moderate | none | quads 1.0, glutes 0.5, core 0.3 |
| goblet-squat-heel-elev | Heel-elevated goblet squat | dumbbell | moderate | none | quads 1.0, glutes 0.3 |
| rfe-split-squat | Rear-foot-elevated split squat | dumbbell | moderate | none | quads 1.0, glutes 0.7, adductors 0.3 |
| split-squat | Split squat | dumbbell | moderate | none | quads 1.0, glutes 0.5 |
| reverse-lunge | Reverse lunge | dumbbell | moderate | low | quads 0.7, glutes 1.0 |
| walking-lunge | Walking lunge | dumbbell | moderate | low | quads 0.8, glutes 0.8 |
| step-up | Step-up (20–25cm) | dumbbell | moderate | low | quads 1.0, glutes 0.7 |
| lateral-step-up | Lateral step-up | dumbbell | moderate | low | quads 1.0, glutes 0.5 |
| spanish-squat | Spanish squat isometric | band | low | none | quads 1.0 |
| wall-sit | Wall sit | bodyweight | low | none | quads 1.0 |
| cyclist-squat | Cyclist squat | dumbbell | moderate | none | quads 1.0, glutes 0.3 |
| landmine-squat | Landmine squat | landmine | moderate | none | quads 1.0, glutes 0.5 |
| leg-extension-band | Band leg extension | band | low | none | quads 1.0 |

*Hip / posterior chain*

| Slug | Name | Equip | Press. | Impact | Muscles |
|---|---|---|---|---|---|
| hip-thrust | Hip thrust | dumbbell | moderate | none | glutes 1.0, hamstrings 0.5 |
| hip-thrust-sl | Single-leg hip thrust | bodyweight | low | none | glutes 1.0, hamstrings 0.5 |
| glute-bridge | Glute bridge | bodyweight | low | none | glutes 1.0, hamstrings 0.3 |
| glute-bridge-band | Band glute bridge | band | low | none | glutes 1.0 |
| sl-rdl | Single-leg Romanian deadlift | dumbbell | moderate | none | hamstrings 1.0, glutes 0.7, erectors 0.3 |
| db-rdl | Dumbbell RDL | dumbbell | high | none | hamstrings 1.0, glutes 0.7, erectors 0.5 |
| back-extension-45 | 45° back extension | bodyweight | low | none | erectors 1.0, glutes 0.7, hamstrings 0.5 |
| sliding-leg-curl | Sliding leg curl (towel) | bodyweight | low | none | hamstrings 1.0, glutes 0.3 |
| band-leg-curl | Band leg curl | band | low | none | hamstrings 1.0 |
| nordic-curl-ecc | Nordic curl (eccentric) | bodyweight | low | none | hamstrings 1.0 |
| hip-abduction-band | Side-lying band abduction | band | low | none | glutes 1.0 |
| lateral-band-walk | Lateral band walk | band | low | none | glutes 1.0 |
| copenhagen-short | Copenhagen plank (short lever) | bodyweight | moderate | none | adductors 1.0, core 0.5 |
| adductor-squeeze | Adductor squeeze isometric | bodyweight | moderate | none | adductors 1.0 |
| good-morning-seated | Seated good morning (light) | dumbbell | moderate | none | hamstrings 1.0, erectors 0.5 |

> **Note for the two adductor entries:** flag with `caution: "close to groin symptoms — introduce only in Phase 3"`. Surface the caution string on selection.

*Calf and foot*

| Slug | Name | Equip | Press. | Impact | Muscles |
|---|---|---|---|---|---|
| calf-raise-standing | Standing calf raise (straight knee) | dumbbell | low | none | calves 1.0 |
| calf-raise-seated | Seated calf raise (bent knee) | dumbbell | low | none | calves 1.0 |
| calf-raise-standing-sl | Single-leg standing calf raise | bodyweight | low | none | calves 1.0 |
| calf-raise-seated-sl | Single-leg seated calf raise | dumbbell | low | none | calves 1.0 |
| calf-raise-toes-elev | Heel raise, towel under toes | bodyweight | low | none | calves 1.0, foot 0.5 |
| tibialis-raise | Tibialis raise (wall) | bodyweight | low | none | tibialis 1.0 |
| short-foot | Short foot exercise | bodyweight | low | none | foot 1.0 |
| towel-scrunch | Towel scrunch | bodyweight | low | none | foot 1.0 |

*Push*

| Slug | Name | Equip | Press. | Impact | Muscles |
|---|---|---|---|---|---|
| db-bench | Dumbbell bench press | dumbbell | moderate | none | chest 1.0, triceps 0.5, delts_front 0.5 |
| db-incline-press | Incline dumbbell press | dumbbell | moderate | none | chest 1.0, delts_front 0.7, triceps 0.5 |
| db-floor-press | Dumbbell floor press | dumbbell | low | none | chest 1.0, triceps 0.5 |
| push-up | Push-up | bodyweight | low | none | chest 1.0, triceps 0.5, core 0.3 |
| push-up-feet-elev | Feet-elevated push-up | bodyweight | low | none | chest 1.0, delts_front 0.5, triceps 0.5 |
| db-fly-flat | Dumbbell fly (flat) | dumbbell | low | none | chest 1.0 |
| db-fly-incline | Dumbbell fly (incline) | dumbbell | low | none | chest 1.0 |
| landmine-press-kneel | Half-kneeling landmine press | landmine | low | none | delts_front 1.0, chest 0.5, triceps 0.5 |
| landmine-press-stand | Standing landmine press | landmine | moderate | none | delts_front 1.0, chest 0.5, core 0.5 |
| db-shoulder-press-seated | Seated dumbbell shoulder press | dumbbell | moderate | none | delts_front 1.0, triceps 0.5 |
| db-arnold-press | Seated Arnold press | dumbbell | moderate | none | delts_front 1.0, delts_side 0.5 |
| band-chest-press | Band chest press | band | low | none | chest 1.0, triceps 0.3 |

*Pull*

| Slug | Name | Equip | Press. | Impact | Muscles |
|---|---|---|---|---|---|
| db-row-one-arm | One-arm dumbbell row (bench-supported) | dumbbell | low | none | lats 1.0, upper_back 0.7, biceps 0.5 |
| db-row-chest-supported | Chest-supported dumbbell row | dumbbell | low | none | upper_back 1.0, lats 0.7, biceps 0.5 |
| db-pullover | Dumbbell pullover | dumbbell | low | none | lats 1.0, chest 0.3 |
| band-lat-pulldown | Band lat pulldown (half-kneeling) | band | low | none | lats 1.0, biceps 0.5 |
| band-row-seated | Seated band row | band | low | none | upper_back 1.0, lats 0.7, biceps 0.3 |
| landmine-row | Single-arm landmine row | landmine | moderate | none | lats 1.0, upper_back 0.7 |
| band-face-pull | Band face pull | band | low | none | delts_rear 1.0, upper_back 0.5 |
| db-rear-delt-fly | Chest-supported rear delt fly | dumbbell | low | none | delts_rear 1.0, upper_back 0.3 |
| band-pull-apart | Band pull-apart | band | low | none | delts_rear 1.0, upper_back 0.3 |
| inverted-row | Inverted row | bodyweight | low | none | upper_back 1.0, lats 0.7, biceps 0.5 |
| db-shrug | Dumbbell shrug | dumbbell | moderate | none | upper_back 1.0 |

*Shoulders and arms*

| Slug | Name | Equip | Press. | Impact | Muscles |
|---|---|---|---|---|---|
| db-lateral-raise | Dumbbell lateral raise | dumbbell | low | none | delts_side 1.0 |
| band-lateral-raise | Band lateral raise | band | low | none | delts_side 1.0 |
| db-curl | Dumbbell curl | dumbbell | low | none | biceps 1.0 |
| db-hammer-curl | Hammer curl | dumbbell | low | none | biceps 1.0 |
| db-incline-curl | Incline dumbbell curl | dumbbell | low | none | biceps 1.0 |
| db-oh-triceps-ext | Seated overhead triceps extension | dumbbell | moderate | none | triceps 1.0 |
| db-skullcrusher | Dumbbell skullcrusher | dumbbell | low | none | triceps 1.0 |
| bench-dip | Bench dip | bodyweight | low | none | triceps 1.0, chest 0.3 |
| band-triceps-pushdown | Band triceps pushdown | band | low | none | triceps 1.0 |

*Core*

| Slug | Name | Equip | Press. | Impact | Muscles |
|---|---|---|---|---|---|
| pallof-press | Band Pallof press | band | low | none | core 1.0 |
| dead-bug | Dead bug | bodyweight | low | none | core 1.0 |
| side-plank | Side plank | bodyweight | low | none | core 1.0 |
| bird-dog | Bird dog | bodyweight | low | none | core 1.0, erectors 0.5 |
| plank | Front plank | bodyweight | moderate | none | core 1.0 |

*Cardio and mobility (duration-logged, no muscle weights)*

`cross-trainer` · `incline-walk` · `flat-walk` · plus 13 mobility items from the programme document, logged as checkboxes only.

### A5.5 Programme seed

Seed Phase 1's six day templates from the programme document, with `slot_swaps` populated. Suggested tier-1 swaps:

| Slot | Approved swaps |
|---|---|
| leg-press | leg-press-sl, goblet-squat-heel-elev, spanish-squat |
| goblet-squat | landmine-squat, cyclist-squat, goblet-squat-heel-elev |
| rfe-split-squat | split-squat, step-up, reverse-lunge |
| sliding-leg-curl | band-leg-curl, nordic-curl-ecc |
| hip-thrust | hip-thrust-sl, glute-bridge, back-extension-45 |
| sl-rdl | back-extension-45, good-morning-seated |
| step-up | lateral-step-up, reverse-lunge, split-squat |
| calf-raise-seated | calf-raise-seated-sl, calf-raise-toes-elev |
| calf-raise-standing | calf-raise-standing-sl, calf-raise-toes-elev |
| db-bench | db-incline-press, db-floor-press, push-up-feet-elev |
| db-row-one-arm | db-row-chest-supported, band-row-seated, inverted-row |
| landmine-press-kneel | db-shoulder-press-seated, db-arnold-press |
| band-lat-pulldown | db-pullover, inverted-row |
| db-incline-press | db-bench, push-up-feet-elev, db-fly-incline |
| db-row-chest-supported | db-row-one-arm, band-row-seated |
| db-pullover | band-lat-pulldown |
| push-up | push-up-feet-elev, band-chest-press |
| band-face-pull | db-rear-delt-fly, band-pull-apart |
| db-curl | db-hammer-curl, db-incline-curl |
| pallof-press | dead-bug, bird-dog |

Phases 2 and 3 can be seeded later; v1 only needs Phase 1 plus the ability to edit templates in settings.

## A6. Explicitly out of scope for v1

Photos, social, video, form checks, calendar sync, trainer login, streaks, badges, achievement copy, drift percentages as a headline metric, skip-reason prompts, any notification other than the 07:00 check, any chart with more than one week on the x-axis, rescheduling of missed days.

**Steps tracking is out.** An iOS PWA cannot read HealthKit, and a manual daily step entry is a number that goes up and down and invites optimising against it. Track steps in whatever the phone already does.

---
