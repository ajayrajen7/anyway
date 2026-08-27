# Vision — Anyway

**North star:** a training programme survives six months only if logging it costs less than the friction of not logging it. Every design decision below exists to protect that.

## Why this exists

One person, six months, a fixed training programme built around three real physical constraints (right knee, bilateral Achilles tendinopathy, groin/lower-abdominal pressure sensitivity — see `docs/programme.md`). Three prior tracking attempts failed. This app is built around *why* they failed, not around fitness-app convention.

## The three constraints that override normal fitness-app conventions

1. **The pain signal is delayed and cumulative.** A flare shows up the next morning or days later, not mid-set. If a deviation from the programme (a swap, an added exercise, a load change) isn't captured at the moment it happens, the pain log becomes uncorrelatable noise. Capturing *what changed* is the entire point — more important than capturing how it felt in the moment.
2. **Logging happens mid-session, one-handed, with a trainer waiting.** Any single interaction costing more than ~2 seconds gets abandoned within three weeks. This is not a UX preference, it's the failure mode of every prior attempt.
3. **Outcome numbers have previously caused the user to quit.** Weight and other outcome data are collected — the programme's own success criteria need them — but deliberately withheld from view until there's enough of it to mean anything (the Vault, `docs/prd.md` §A4). Daily outcome numbers are demotivating noise at this signal-to-noise ratio; withholding them is a feature, not a limitation.

## Durable principles

- **Capture, don't analyze.** v1 builds no correlation, no trend line, no insight text. The one analytical screen (Week View) is descriptive counts only. Analysis is either premature (not enough data) or actively counterproductive (see constraint 3) until week 12.
- **Absence is data.** An unlogged pain day is not `none` — it's missing. Never impute, never default. A missed session stays `missed`, never silently rescheduled — comparability across weeks is the product.
- **Provenance over judgment.** The app doesn't decide whether a swap or an added exercise was wise. It records what happened and who decided, cleanly enough that the pattern becomes visible over time on its own.
- **Offline is not a fallback, it's the primary mode.** Gym basements have no signal. The session runner must work exactly as well with no network as with a great connection — see `docs/architecture.md` §B2.
- **Every fitness-app convention this spec omits is a deliberate omission**, not an oversight: streaks, badges, encouragement copy, drift percentages as a headline metric, notifications beyond the one morning check, multi-week charts. Each one re-creates a failure mode a prior attempt already hit. Resist adding them as "obvious improvements" mid-build (`docs/architecture.md` §B8).

## What success looks like

Not weight. See `docs/programme.md` Part 8 for the actual six-month markers (flare frequency, consecutive training days tolerated, exercises per session, mobility markers). The app's job is to make the *inputs* to those markers — pain, load, provenance — reliably logged for six months. Nothing else is the job.
