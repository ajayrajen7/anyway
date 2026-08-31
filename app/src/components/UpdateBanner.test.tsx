// Real bug fixed here (see UpdateBanner.tsx's own doc comment): a new
// deploy used to reload the page automatically, silently discarding
// in-progress set data. This asserts the banner only ever reloads on an
// explicit tap — never on its own.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UpdateBanner from './UpdateBanner';

// jsdom doesn't implement navigator.serviceWorker at all — stand in a bare
// EventTarget so the component's own addEventListener/dispatchEvent calls
// have something real to work against.
beforeEach(() => {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: new EventTarget(),
    configurable: true,
  });
});

function fireControllerChange() {
  navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UpdateBanner', () => {
  it('renders nothing until a new service worker takes control', () => {
    render(<UpdateBanner />);
    expect(screen.queryByText(/update available/i)).not.toBeInTheDocument();
  });

  it('shows a manual Refresh prompt once controllerchange fires, and does not reload on its own', async () => {
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });
    render(<UpdateBanner />);

    fireControllerChange();

    expect(await screen.findByText(/update available/i)).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('only reloads when the Refresh button is tapped', async () => {
    const user = userEvent.setup();
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });
    render(<UpdateBanner />);

    fireControllerChange();
    await user.click(await screen.findByRole('button', { name: 'Refresh' }));

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
