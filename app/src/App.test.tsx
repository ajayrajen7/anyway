import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

// Today fetches on mount — stub it to a never-resolving promise so this
// routing smoke test never issues a real network call. See Today.test.tsx
// for the loaded/error states.
vi.mock('./lib/api', async () => {
  const actual = await vi.importActual<typeof import('./lib/api')>('./lib/api');
  return { ...actual, getToday: () => new Promise(() => {}) };
});

describe('App routing smoke test', () => {
  it('renders the Today screen at / (loading state — see Today.test.tsx for loaded states)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders the Morning Check screen at /check with exactly 4 pain buttons', () => {
    render(
      <MemoryRouter initialEntries={['/check']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });
});
