import { Route, Routes } from 'react-router-dom';
import AddExercise from './routes/AddExercise';
import MorningCheck from './routes/MorningCheck';
import SessionRunner from './routes/SessionRunner';
import SessionSummary from './routes/SessionSummary';
import Settings from './routes/Settings';
import SwapSheet from './routes/SwapSheet';
import Today from './routes/Today';
import Week from './routes/Week';
import WeighIn from './routes/WeighIn';

// Route map — A3. Screens are stubs until their milestone (see docs/implementation-plan.md).
//
// Swap and Add-exercise are *sheets* (§A3.4/§A3.5) — nested under
// /session/:id so SessionRunner never unmounts while one is open. That's
// not just fidelity to "sheet" styling: it's what keeps SessionRunner's own
// state (which exercise you're on) intact across the round trip, with no
// need to persist/restore position via the URL or localStorage (see M5 in
// memory.md). Session summary (`/done`) is a real full-screen navigation —
// the session is over, there's nothing left to preserve.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Today />} />
      <Route path="/check" element={<MorningCheck />} />
      <Route path="/weigh" element={<WeighIn />} />
      <Route path="/session/:id" element={<SessionRunner />}>
        <Route path="swap/:slotId" element={<SwapSheet />} />
        <Route path="add" element={<AddExercise />} />
      </Route>
      <Route path="/session/:id/done" element={<SessionSummary />} />
      <Route path="/week" element={<Week />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  );
}
