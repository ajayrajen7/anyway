// Thin fetch wrapper for the Go API (docs/architecture.md §B5). Auth is a
// single static bearer token (B1) — no session/cookie plumbing, one user.
import { Exercise, ProgrammeResponse, SyncResult, TodayResponse } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const API_TOKEN = import.meta.env.VITE_API_TOKEN ?? '';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_TOKEN}`,
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// GET /api/today?date=YYYY-MM-DD — `date` must be the caller's *local*
// calendar day (src/lib/date.ts#localDateKey), never the server's. Validated
// with Zod at the boundary per the carried-over discipline.
export async function getToday(date: string): Promise<TodayResponse> {
  const raw = await apiFetch<unknown>(`/api/today?date=${encodeURIComponent(date)}`);
  return TodayResponse.parse(raw);
}

// GET /api/exercises?include_blocked=1 — the *whole* library, blocked
// exercises included. This is only ever called while online (from
// src/lib/exerciseCache.ts, triggered by Today.tsx) to refresh the offline
// search cache used by the Swap/Add screens — never called directly from
// those screens themselves, which must stay network-free (§B2).
export async function getExerciseLibrary(): Promise<Exercise[]> {
  const raw = await apiFetch<unknown>('/api/exercises?include_blocked=1');
  return Exercise.array().parse(raw);
}

// GET /api/programme — the active phase's full week structure (M8
// amendment to §B5, see memory.md). Only called while online (from
// src/lib/programmeCache.ts, triggered by Today.tsx) to refresh the Week
// View's offline cache — the Week screen itself never calls the network.
export async function getProgramme(): Promise<ProgrammeResponse> {
  const raw = await apiFetch<unknown>('/api/programme');
  return ProgrammeResponse.parse(raw);
}

// POST /api/sync — the batched outbox drain (M9, docs/architecture.md §B5).
// Sends every not-yet-synced outbox row in one request; the response tells
// the caller (src/lib/sync.ts) which ones landed so it knows which local
// rows to mark synced. One bad entry never fails the whole batch server-side
// (see server/internal/sync#Drain) — the *response* carries per-entry
// success/failure, not the HTTP status.
export async function postSync(
  entries: { entity: string; entity_id: string; payload: unknown }[],
): Promise<SyncResult[]> {
  const raw = await apiFetch<unknown>('/api/sync', { method: 'POST', body: JSON.stringify(entries) });
  return SyncResult.array().parse(raw);
}
