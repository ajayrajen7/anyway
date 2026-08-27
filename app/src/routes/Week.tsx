// A3.7 Week View (`/week`) — the only non-capture screen in v1.
// Coverage numbers AND the 7-day pain strip must render in one scroll view —
// never split into tabs/routes (B6.5). Descriptive only: no correlation,
// no trend lines, no multi-week charts, no generated insight text.
// TODO(M8): GET /api/week — coverage actual/prescribed + volume + pain dots.
export default function Week() {
  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-lg font-medium">Week</h1>
      <p className="mt-2 text-sm text-slate-400">Scaffold stub.</p>
    </main>
  );
}
