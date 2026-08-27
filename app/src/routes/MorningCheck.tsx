// A3.1 Morning Check (`/check`) — full-screen, 4 buttons, closes on tap.
// No history/streak/graph/encouragement text on this screen. Ever.
// TODO(M6): wire to POST /api/morning-check; local 07:00 notification + 11:00 re-notify.
const PAIN_LEVELS = ['None', 'Background', 'Noticeable', 'Limiting'] as const;

export default function MorningCheck() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl">How are the last 24 hours?</h1>
      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
        {PAIN_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className="rounded-lg bg-slate-800 py-4 text-base"
          >
            {level}
          </button>
        ))}
      </div>
    </main>
  );
}
