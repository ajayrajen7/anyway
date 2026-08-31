// IndexedDB (Dexie) — the source of truth during a session (B2). The session
// runner reads/writes here only and never awaits a network call. A background
// sync worker (M9) drains `outbox` to the server when connectivity returns.
import Dexie, { type Table } from 'dexie';
import type {
  CachedProgramme,
  CachedToday,
  CardioLog,
  DayConfirmation,
  Exercise,
  LoggedSet,
  MobilityLog,
  MorningCheck,
  OutboxEntry,
  ProteinLog,
  SessionOverlay,
  StepsLog,
} from './types';

export class AppDatabase extends Dexie {
  exercises!: Table<Exercise, number>;
  loggedSets!: Table<LoggedSet, number>;
  morningChecks!: Table<MorningCheck, string>;
  outbox!: Table<OutboxEntry, number>;
  todayCache!: Table<CachedToday, number>;
  sessionOverlay!: Table<SessionOverlay, number>;
  proteinLogs!: Table<ProteinLog, string>;
  mobilityLogs!: Table<MobilityLog, string>;
  cardioLogs!: Table<CardioLog, number>;
  programmeCache!: Table<CachedProgramme, number>;
  stepsLogs!: Table<StepsLog, string>;
  dayConfirmations!: Table<DayConfirmation, string>;

  constructor() {
    super('anyway');
    // Schema versions are additive — extend with a new .version() block as
    // milestones land; never rewrite a shipped version in place once real
    // data exists on-device.
    this.version(1).stores({
      exercises: 'id, slug, blocked',
      loggedSets: '++id, client_uuid, session_id, exercise_id, logged_at',
      morningChecks: 'date',
      outbox: '++id, entity, entity_id, synced_at',
    });
    // M4: a compound index for reconstructing a session's already-logged
    // sets on remount (SessionRunner never trusts only its own React state —
    // it re-derives from Dexie, per B2), and todayCache for the offline
    // read path (see src/lib/types.ts#CachedToday).
    this.version(2).stores({
      loggedSets: '++id, client_uuid, session_id, exercise_id, logged_at, [session_id+exercise_id]',
      todayCache: 'sessionId, date',
    });
    // M5: the exercise library (populated from GET /api/exercises whenever
    // Today.tsx has a connection — see src/lib/exerciseCache.ts) so the swap
    // and add-exercise search screens can search offline, and a per-session
    // overlay recording swaps/additions without mutating the immutable
    // todayCache snapshot (see src/lib/overlay.ts, src/lib/types.ts#SessionOverlay).
    this.version(3).stores({
      exercises: 'id, slug, blocked, name',
      sessionOverlay: 'sessionId',
    });
    // M7: protein (yes/no, always a real value once answered), mobility
    // (presence-only — see src/lib/types.ts#MobilityLog), and cardio
    // (one row per date+modality by convention, enforced in
    // src/lib/dailyLogs.ts, not by a DB constraint).
    this.version(4).stores({
      proteinLogs: 'date',
      mobilityLogs: 'date',
      cardioLogs: '++id, date, modality, [date+modality]',
    });
    // M8: the active phase's full week structure (GET /api/programme), so
    // the Week View can compute prescribed coverage offline — see
    // src/lib/programmeCache.ts, src/lib/types.ts#CachedProgramme.
    this.version(5).stores({
      programmeCache: 'id',
    });
    // M9: weigh-ins (prd.md's old §A4, "the Vault") — dropped entirely in
    // the UX refactor (the owner doesn't want weight tracking). `weighIns`
    // is removed (`null` deletes a store on upgrade — Dexie's own way to
    // drop a table) rather than left behind as dead schema, and
    // `stepsLogs` (a real daily count, alongside protein) takes its slot
    // in this version bump. See memory.md.
    this.version(7).stores({
      weighIns: null,
      stepsLogs: 'date',
    });
    // Whole-day "Done for today", round 2: an explicit tap, not an auto-
    // collapse — see src/lib/types.ts#DayConfirmation for the full reasoning.
    this.version(8).stores({
      dayConfirmations: 'date',
    });
  }
}

export const db = new AppDatabase();
