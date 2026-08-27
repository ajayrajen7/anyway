// IndexedDB (Dexie) — the source of truth during a session (B2). The session
// runner reads/writes here only and never awaits a network call. A background
// sync worker (M9) drains `outbox` to the server when connectivity returns.
import Dexie, { type Table } from 'dexie';
import type { Exercise, LoggedSet, MorningCheck, OutboxEntry } from './types';

export class AppDatabase extends Dexie {
  exercises!: Table<Exercise, number>;
  loggedSets!: Table<LoggedSet, number>;
  morningChecks!: Table<MorningCheck, string>;
  outbox!: Table<OutboxEntry, number>;

  constructor() {
    super('anyway');
    // Schema v1 — extend with new versions as milestones land; never rewrite
    // a shipped version in place once real data exists on-device.
    this.version(1).stores({
      exercises: 'id, slug, blocked',
      loggedSets: '++id, client_uuid, session_id, exercise_id, logged_at',
      morningChecks: 'date',
      outbox: '++id, entity, entity_id, synced_at',
    });
  }
}

export const db = new AppDatabase();
