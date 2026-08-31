import { Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import UpdateBanner from './components/UpdateBanner';
import AddExercise from './routes/AddExercise';
import Coverage from './routes/Coverage';
import DayPreview from './routes/DayPreview';
import MorningCheck from './routes/MorningCheck';
import SessionExercise from './routes/SessionExercise';
import SessionOverview from './routes/SessionOverview';
import SessionSummary from './routes/SessionSummary';
import Settings from './routes/Settings';
import SwapSheet from './routes/SwapSheet';
import Today from './routes/Today';
import WeekPlan from './routes/WeekPlan';

// Route map — A3, reshaped by the UX refactor around a persistent bottom
// nav (Today / Coverage / Week Plan — see AppShell.tsx). Everything else —
// the session flow, morning check, settings — stays outside that shell:
// full-screen flows you enter and leave, not places to idly switch tabs.
//
// The session's exercise-list (`/session/:id`) and single-exercise screen
// (`/session/:id/exercise/:key`) are each other's siblings, not nested —
// "start from any exercise" means real navigation between them, not a
// sequential Next/Skip walk. Add is a sheet nested under the list (reached
// from there); Swap is a sheet nested under the single-exercise screen
// (reached from either the list, in one navigation, or the exercise screen
// itself) — see docs/architecture.md §B6.1's amendment and memory.md.
export default function App() {
  return (
    <>
      {/* Mounted once, above every route — see UpdateBanner.tsx for why a
          detected update shows a manual "Refresh" prompt here instead of
          reloading the page automatically (that silently destroyed
          in-progress set data before the fix). */}
      <UpdateBanner />
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Today />} />
          <Route path="/coverage" element={<Coverage />} />
          <Route path="/week" element={<WeekPlan />} />
        </Route>
        <Route path="/check" element={<MorningCheck />} />
        <Route path="/day/:date" element={<DayPreview />} />
        <Route path="/session/:id" element={<SessionOverview />}>
          <Route path="add" element={<AddExercise />} />
        </Route>
        <Route path="/session/:id/exercise/:key" element={<SessionExercise />}>
          <Route path="swap/:slotId" element={<SwapSheet />} />
        </Route>
        <Route path="/session/:id/done" element={<SessionSummary />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </>
  );
}
