import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db';
import { logSet } from '../lib/outbox';
import SessionSummary from './SessionSummary';

function renderSummary(sessionId = 42) {
  return render(
    <MemoryRouter initialEntries={[`/session/${sessionId}/done`]}>
      <Routes>
        <Route path="/session/:id/done" element={<SessionSummary />} />
        <Route path="/" element={<div>Today screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(async () => {
  await db.loggedSets.clear();
  await db.outbox.clear();
});

describe('SessionSummary', () => {
  it('shows counts and total volume computed from this session\'s logged sets', async () => {
    await logSet({ sessionId: 42, slotId: 1, exerciseId: 10, setIndex: 1, loadKg: 20, reps: 10, status: 'done' });
    await logSet({ sessionId: 42, slotId: 1, exerciseId: 10, setIndex: 2, loadKg: 20, reps: 8, status: 'done' });
    await logSet({ sessionId: 42, slotId: 1, exerciseId: 10, setIndex: 3, loadKg: null, reps: null, status: 'skipped' });
    // a different session's sets must not leak into this summary
    await logSet({ sessionId: 999, slotId: 2, exerciseId: 20, setIndex: 1, loadKg: 100, reps: 100, status: 'done' });

    renderSummary(42);

    expect(await screen.findByText('2 sets done')).toBeInTheDocument();
    expect(screen.getByText('1 sets skipped')).toBeInTheDocument();
    expect(screen.getByText(`${20 * 10 + 20 * 8} kg total volume`)).toBeInTheDocument();
  });

  it('queues a session_complete outbox entry exactly once, even if revisited', async () => {
    renderSummary(42);
    await screen.findByText('0 sets done');

    renderSummary(42); // simulate a second visit
    await screen.findAllByText('0 sets done');

    const entries = await db.outbox.where({ entity: 'session_complete', entity_id: '42' }).toArray();
    expect(entries).toHaveLength(1);
  });

  it('links back to Today', async () => {
    renderSummary(42);
    const link = await screen.findByRole('link', { name: 'Done' });
    expect(link).toHaveAttribute('href', '/');
  });
});
