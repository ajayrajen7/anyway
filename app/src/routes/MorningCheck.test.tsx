import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import { localDateKey } from '../lib/date';
import MorningCheck from './MorningCheck';

afterEach(async () => {
  await db.morningChecks.clear();
  await db.outbox.clear();
  vi.restoreAllMocks();
});

describe('MorningCheck', () => {
  it('shows exactly the 4 pain-level buttons when nothing is logged yet, with no other text', async () => {
    render(<MorningCheck />);
    const buttons = await screen.findAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['None', 'Background', 'Noticeable', 'Limiting']);
  });

  it('tapping a level persists it and replaces the question with a neutral confirmation', async () => {
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<MorningCheck />);

    await user.click(await screen.findByRole('button', { name: 'Background' }));

    expect(await screen.findByText('Logged.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(closeSpy).toHaveBeenCalled();

    const stored = await db.morningChecks.get(localDateKey());
    expect(stored).toEqual({ date: localDateKey(), pain: 'background' });
  });

  it('shows the confirmation immediately, without the buttons, if today was already logged', async () => {
    await db.morningChecks.put({ date: localDateKey(), pain: 'noticeable' });
    render(<MorningCheck />);

    expect(await screen.findByText('Logged.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('never renders a link or any navigation element — this screen never routes anywhere', async () => {
    render(<MorningCheck />);
    await screen.findAllByRole('button');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
