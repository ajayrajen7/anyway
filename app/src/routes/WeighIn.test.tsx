import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import WeighIn from './WeighIn';

const { isSundayMock } = vi.hoisted(() => ({ isSundayMock: vi.fn(() => true) }));
vi.mock('../lib/date', async () => {
  const actual = await vi.importActual<typeof import('../lib/date')>('../lib/date');
  return { ...actual, isSunday: isSundayMock };
});

afterEach(async () => {
  isSundayMock.mockReset().mockReturnValue(true);
  await db.weighIns.clear();
  await db.outbox.clear();
});

describe('WeighIn', () => {
  it('shows a gated message on any day that is not Sunday, with no stepper', async () => {
    isSundayMock.mockReturnValue(false);
    render(<WeighIn />);

    expect(await screen.findByText(/sundays only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Increase weight' })).not.toBeInTheDocument();
  });

  it('on Sunday with nothing logged yet, shows the stepper defaulting to 70.0 kg', async () => {
    render(<WeighIn />);

    expect(await screen.findByText('70.0 kg')).toBeInTheDocument();
  });

  it('the stepper buttons adjust the visible value by 0.5 kg', async () => {
    const user = userEvent.setup();
    render(<WeighIn />);
    await screen.findByText('70.0 kg');

    await user.click(screen.getByRole('button', { name: 'Increase weight' }));
    expect(screen.getByText('70.5 kg')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Decrease weight' }));
    await user.click(screen.getByRole('button', { name: 'Decrease weight' }));
    expect(screen.getByText('69.5 kg')).toBeInTheDocument();
  });

  it('tapping Save persists the value and shows a confirmation with no number in it', async () => {
    const user = userEvent.setup();
    render(<WeighIn />);
    await screen.findByText('70.0 kg');

    await user.click(screen.getByRole('button', { name: 'Increase weight' })); // 70.5

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText(/saved/i);
    expect(screen.queryByText(/70\.5/)).not.toBeInTheDocument();
    expect(screen.queryByText(/kg/)).not.toBeInTheDocument();

    expect(await db.weighIns.get(new Date().toISOString().slice(0, 10))).toEqual(
      expect.objectContaining({ weight_kg: 70.5 }),
    );
  });

  it('re-visiting on the same Sunday after already saving goes straight to the confirmation, not the stepper', async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    await db.weighIns.put({ date: todayKey, weight_kg: 75 });

    render(<WeighIn />);

    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Increase weight' })).not.toBeInTheDocument();
  });
});
