// Thin fetch wrapper for the Go API (docs/architecture.md §B5). Auth is a
// single static bearer token (B1) — no session/cookie plumbing, one user.
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
