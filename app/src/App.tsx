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
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Today />} />
      <Route path="/check" element={<MorningCheck />} />
      <Route path="/weigh" element={<WeighIn />} />
      <Route path="/session/:id" element={<SessionRunner />} />
      <Route path="/session/:id/swap/:slotId" element={<SwapSheet />} />
      <Route path="/session/:id/add" element={<AddExercise />} />
      <Route path="/session/:id/done" element={<SessionSummary />} />
      <Route path="/week" element={<Week />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  );
}
