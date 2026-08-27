// The full mobility protocol's checklist (docs/programme.md Part 4, "Full
// version (25 min)"), shown on Wed/Sat's light day (§A3.6) via "View".
// Individual ticks are optional and not persisted anywhere — the schema has
// no per-item table, only mobility_logs(date) for "done at all today"
// (§B3) — so this list is presentation-only, reset every time it's opened.
//
// Note: prd.md §A5.4 says "13 mobility items from the programme document",
// but programme.md's own Full version list enumerates only 12 (3+3+4+2
// across its four sections). Transcribed exactly as programme.md lists
// them rather than inventing a 13th to match the other doc's count —
// flagged in memory.md as a cross-doc discrepancy, not resolved by guessing.
export const MOBILITY_ITEMS: string[] = [
  'Knee-to-wall dorsiflexion',
  'Calf stretch, straight knee then bent knee',
  'Short foot exercise',
  'Supine hamstring stretch with strap',
  'Sciatic nerve slider',
  'Cat-camel',
  'Couch stretch',
  'Figure-4 glute stretch',
  '90/90 hip switches',
  'Adductor rock-back',
  'Open books',
  'Heel-elevated goblet squat hold',
];
