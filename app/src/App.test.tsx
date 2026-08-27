import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App routing smoke test', () => {
  it('renders the Today screen at /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
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
