// A3.3 Session Runner (`/session/:id`) — the core screen. One exercise at a time.
// HARD RULE (B6.1): no <input type="number"> or any focusable text field anywhere
// in this subtree. Steppers only. This is enforced by a test — see
// src/routes/SessionRunner.test.tsx (added in M4).
// TODO(M4): set logging, pre-fill from last actual, rest timer, stepper inputs.
export default function SessionRunner() {
  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-lg font-medium">Session</h1>
      <p className="mt-2 text-sm text-slate-400">Scaffold stub.</p>
    </main>
  );
}
