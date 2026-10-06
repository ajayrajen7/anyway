import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { ApiError } from '../lib/api';
import { db } from '../lib/db';
import Library from './Library';
import type { Exercise } from '../lib/types';

const { generateExerciseMock, archiveExerciseMock, refreshLibraryMock } = vi.hoisted(() => ({
  generateExerciseMock: vi.fn(),
  archiveExerciseMock: vi.fn(),
  refreshLibraryMock: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, generateExercise: generateExerciseMock, archiveExercise: archiveExerciseMock };
});

vi.mock('../lib/exerciseCache', async () => {
  const actual = await vi.importActual<typeof import('../lib/exerciseCache')>('../lib/exerciseCache');
  return { ...actual, cacheExerciseLibrary: refreshLibraryMock };
});

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 1,
    slug: 'sample-exercise',
    name: 'Sample exercise',
    equipment: 'dumbbell',
    pressure: 'low',
    impact: 'none',
    unilateral: false,
    increment_kg: 2.5,
    blocked: false,
    block_reason: null,
    caution: null,
    muscles: { chest: 1.0 },
    ...overrides,
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

function renderLibrary() {
  return render(
    <MemoryRouter initialEntries={['/library']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/library" element={<Library />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(async () => {
  cleanup();
  generateExerciseMock.mockReset();
  archiveExerciseMock.mockReset();
  refreshLibraryMock.mockReset();
  setOnline(true);
  await db.exercises.clear();
});

describe('Library', () => {
  it('refreshes the cached library on mount while online', async () => {
    setOnline(true);
    refreshLibraryMock.mockImplementation(async () => {
      await db.exercises.put(exercise({ id: 7, slug: 'machine-row', name: 'Machine row', muscles: { upper_back: 1.0 } }));
    });

    renderLibrary();

    const back = await screen.findByRole('region', { name: 'Back' });
    expect(refreshLibraryMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(back).getByRole('button', { name: /Back, 1 exercises/i })).toBeInTheDocument());
    await userEvent.click(within(back).getByRole('button', { name: /Back, 1 exercises/i }));
    expect(await within(back).findByRole('heading', { name: 'Machine row' })).toBeInTheDocument();
  });

  it('browses cached exercises offline and lists cross-group impacts with their weights', async () => {
    setOnline(false);
    await db.exercises.bulkPut([
      exercise({ id: 1, slug: 'press', name: 'Chest press', muscles: { chest: 1.0, delts_front: 0.5 } }),
      exercise({
        id: 2,
        slug: 'blocked-run',
        name: 'Running',
        blocked: true,
        block_reason: 'Impact — knee and Achilles',
        source: 'llm',
        muscles: { calves: 1.0 },
      }),
    ]);

    renderLibrary();

    expect(await screen.findByRole('heading', { name: 'Exercise library' })).toBeInTheDocument();
    const chest = screen.getByRole('region', { name: 'Chest' });
    const shoulders = screen.getByRole('region', { name: 'Shoulders & Arms' });
    const legs = screen.getByRole('region', { name: 'Legs' });
    await userEvent.click(within(chest).getByRole('button', { name: /Chest, 1 exercises/i }));
    await userEvent.click(within(shoulders).getByRole('button', { name: /Shoulders & Arms, 1 exercises/i }));
    await userEvent.click(within(legs).getByRole('button', { name: /Legs, 1 exercises/i }));
    expect(within(chest).getByRole('heading', { name: 'Chest press' })).toBeInTheDocument();
    expect(within(chest).getByText('Chest 1.0')).toBeInTheDocument();
    expect(within(shoulders).getByRole('heading', { name: 'Chest press' })).toBeInTheDocument();
    expect(within(shoulders).getByText('Front delts 0.5')).toBeInTheDocument();
    expect(within(legs).getByRole('heading', { name: 'Running' })).toBeInTheDocument();
    expect(within(legs).getByText('Impact — knee and Achilles')).toBeInTheDocument();
    expect(within(legs).getByText('AI-estimated')).toBeInTheDocument();
    expect(refreshLibraryMock).not.toHaveBeenCalled();
  });

  it('calls the existing generator with the selected section and caches its returned muscle weights', async () => {
    setOnline(true);
    refreshLibraryMock.mockResolvedValue(undefined);
    const generated = exercise({
      id: 15,
      slug: 'lat-pulldown',
      name: 'Lat pulldown',
      source: 'llm',
      muscles: { lats: 1.0, biceps: 0.5 },
      caution: 'Keep the ribs relaxed.',
    });
    generateExerciseMock.mockResolvedValue(generated);

    renderLibrary();
    await screen.findByRole('heading', { name: 'Exercise library' });
    await userEvent.click(screen.getByRole('button', { name: 'Add exercise to Back' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Exercise name' }), 'Lat pulldown');
    await userEvent.type(screen.getByRole('textbox', { name: 'Description or equipment (optional)' }), 'Neutral grip');
    await userEvent.click(screen.getByRole('button', { name: 'Create exercise' }));

    await waitFor(() => expect(generateExerciseMock).toHaveBeenCalledTimes(1));
    expect(generateExerciseMock).toHaveBeenCalledWith(
      'Lat pulldown',
      expect.stringContaining('Back'),
    );
    expect(generateExerciseMock.mock.calls[0][1]).toContain('Neutral grip');
    expect(await db.exercises.get(15)).toMatchObject({ name: 'Lat pulldown', muscles: { lats: 1.0, biceps: 0.5 } });
    expect(screen.getAllByRole('heading', { name: 'Lat pulldown' })).toHaveLength(1);
    expect(screen.getByText('AI-estimated — review before use')).toBeInTheDocument();
    expect(screen.getAllByText('Keep the ribs relaxed.')).toHaveLength(2);
    const back = screen.getByRole('region', { name: 'Back' });
    const shoulders = screen.getByRole('region', { name: 'Shoulders & Arms' });
    await userEvent.click(within(shoulders).getByRole('button', { name: /Shoulders & Arms, 1 exercises/i }));
    expect(screen.getAllByRole('heading', { name: 'Lat pulldown' })).toHaveLength(2);
    expect(screen.getAllByText('Keep the ribs relaxed.')).toHaveLength(3);
    expect(within(back).getByText('Lats 1.0')).toBeInTheDocument();
    expect(within(shoulders).getByText('Biceps 0.5')).toBeInTheDocument();
    const result = screen.getByRole('status');
    expect(within(result).getByText('Lats 1.0')).toBeInTheDocument();
    expect(within(result).getByText('Biceps 0.5')).toBeInTheDocument();
  });

  it('explains that creation requires a connection while offline', async () => {
    setOnline(false);
    renderLibrary();
    await screen.findByRole('heading', { name: 'Exercise library' });
    await userEvent.click(screen.getByRole('button', { name: 'Add exercise to Back' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Exercise name' }), 'Cable row');

    expect(screen.getByRole('button', { name: 'Create exercise' })).toBeDisabled();
    expect(screen.getByText("Creating a new exercise needs a connection — you're offline.")).toBeInTheDocument();
    expect(generateExerciseMock).not.toHaveBeenCalled();
  });

  it('shows a generated blocked exercise with its reason and estimated impacts', async () => {
    setOnline(true);
    refreshLibraryMock.mockResolvedValue(undefined);
    generateExerciseMock.mockResolvedValue(
      exercise({
        id: 25,
        slug: 'hanging-leg-raise',
        name: 'Hanging leg raise',
        source: 'llm',
        blocked: true,
        block_reason: 'High intra-abdominal pressure',
        pressure: 'high',
        muscles: { core: 1.0 },
      }),
    );

    renderLibrary();
    await screen.findByRole('heading', { name: 'Exercise library' });
    await userEvent.click(screen.getByRole('button', { name: 'Add exercise to Core' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Exercise name' }), 'Hanging leg raise');
    await userEvent.click(screen.getByRole('button', { name: 'Create exercise' }));

    const result = await screen.findByRole('status');
    expect(within(result).getByText('Blocked: High intra-abdominal pressure')).toBeInTheDocument();
    expect(within(result).getByText('Core 1.0')).toBeInTheDocument();
    const core = screen.getByRole('region', { name: 'Core' });
    expect(within(core).getByText('Blocked')).toBeInTheDocument();
    expect(await db.exercises.get(25)).toMatchObject({ blocked: true, block_reason: 'High intra-abdominal pressure' });
  });

  it('startsWithEveryMuscleGroupCollapsed', async () => {
    setOnline(false);
    await db.exercises.put(exercise());
    renderLibrary();
    await screen.findByRole('heading', { name: 'Exercise library' });
    for (const label of ['Chest', 'Back', 'Shoulders & Arms', 'Legs', 'Core']) {
      const group = screen.getByRole('region', { name: label });
      const disclosure = within(group).getByRole('button', { name: new RegExp(`^${label},`) });
      expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      expect(disclosure).toHaveAttribute('aria-controls');
      expect(within(group).queryByRole('heading', { name: 'Sample exercise' })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: 'Chest' })).toHaveTextContent('1 exercises');
  });

  it('expandsOnlyTheSelectedGroup', async () => {
    setOnline(false);
    await db.exercises.put(exercise({ muscles: { chest: 1, delts_front: 0.5 } }));
    renderLibrary();
    const chest = await screen.findByRole('region', { name: 'Chest' });
    const shoulders = screen.getByRole('region', { name: 'Shoulders & Arms' });
    await userEvent.click(within(chest).getByRole('button', { name: /Chest, 1 exercises/i }));
    expect(within(chest).getByRole('heading', { name: 'Sample exercise' })).toBeInTheDocument();
    expect(within(shoulders).queryByRole('heading', { name: 'Sample exercise' })).not.toBeInTheDocument();
    expect(within(shoulders).getByRole('button', { name: /Shoulders & Arms, 1 exercises/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('addActionIsVisibleAndIndependentOfDisclosure', async () => {
    setOnline(false);
    renderLibrary();
    const back = await screen.findByRole('region', { name: 'Back' });
    const disclosure = within(back).getByRole('button', { name: /Back, 0 exercises/i });
    expect(within(back).getByRole('button', { name: 'Add exercise to Back' })).toBeVisible();
    await userEvent.click(within(back).getByRole('button', { name: 'Add exercise to Back' }));
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(within(back).getByRole('textbox', { name: 'Exercise name' })).toBeInTheDocument();
    await userEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(within(back).queryByRole('textbox', { name: 'Exercise name' })).not.toBeInTheDocument();
  });

  it('cancelledArchiveKeepsExercise', async () => {
    setOnline(false);
    await db.exercises.put(exercise());
    setOnline(true);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderLibrary();
    const chest = await screen.findByRole('region', { name: 'Chest' });
    await userEvent.click(within(chest).getByRole('button', { name: /Chest, 1 exercises/i }));
    await userEvent.click(within(chest).getByRole('button', { name: 'Archive Sample exercise' }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/existing plans and history.*intact/i));
    expect(archiveExerciseMock).not.toHaveBeenCalled();
    expect(within(chest).getByRole('heading', { name: 'Sample exercise' })).toBeInTheDocument();
    expect((await db.exercises.get(1))?.active).not.toBe(false);
    confirmSpy.mockRestore();
  });

  it('archivesCrossListedExerciseFromEveryGroup', async () => {
    setOnline(false);
    await db.exercises.put(exercise({ muscles: { chest: 1, delts_front: 0.5 } }));
    setOnline(true);
    refreshLibraryMock.mockResolvedValue(undefined);
    archiveExerciseMock.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderLibrary();
    const chest = await screen.findByRole('region', { name: 'Chest' });
    const shoulders = screen.getByRole('region', { name: 'Shoulders & Arms' });
    await userEvent.click(within(chest).getByRole('button', { name: /Chest, 1 exercises/i }));
    await userEvent.click(within(shoulders).getByRole('button', { name: /Shoulders & Arms, 1 exercises/i }));
    await userEvent.click(within(chest).getByRole('button', { name: 'Archive Sample exercise' }));
    await waitFor(() => expect((within(chest).queryByRole('heading', { name: 'Sample exercise' }))).not.toBeInTheDocument());
    expect(within(shoulders).queryByRole('heading', { name: 'Sample exercise' })).not.toBeInTheDocument();
    expect(chest).toHaveTextContent('0 exercises');
    expect(shoulders).toHaveTextContent('0 exercises');
    expect(await db.exercises.get(1)).toMatchObject({ active: false });
    confirmSpy.mockRestore();
  });

  it('keepsExerciseVisibleUntilServerConfirmsArchive', async () => {
    setOnline(false);
    await db.exercises.put(exercise());
    setOnline(true);
    refreshLibraryMock.mockResolvedValue(undefined);
    let resolveArchive!: () => void;
    archiveExerciseMock.mockImplementation(() => new Promise<void>((resolve) => { resolveArchive = resolve; }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderLibrary();
    const chest = await screen.findByRole('region', { name: 'Chest' });
    await userEvent.click(within(chest).getByRole('button', { name: /Chest, 1 exercises/i }));
    await userEvent.click(within(chest).getByRole('button', { name: 'Archive Sample exercise' }));
    expect(within(chest).getByRole('heading', { name: 'Sample exercise' })).toBeInTheDocument();
    expect(within(chest).getByRole('button', { name: 'Archive Sample exercise' })).toBeDisabled();
    expect((await db.exercises.get(1))?.active).not.toBe(false);
    resolveArchive();
    await waitFor(() => expect(within(chest).queryByRole('heading', { name: 'Sample exercise' })).not.toBeInTheDocument());
    confirmSpy.mockRestore();
  });

  it('staleRefreshCannotRestoreArchivedExercise', async () => {
    setOnline(false);
    const original = exercise({ active: true, muscles: { chest: 1, delts_front: 0.5 } });
    await db.exercises.put(original);
    setOnline(true);
    let resolveRefresh!: () => void;
    refreshLibraryMock.mockImplementation(async () => {
      await new Promise<void>((resolve) => { resolveRefresh = resolve; });
      await db.exercises.put(original);
    });
    archiveExerciseMock.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderLibrary();
    const chest = await screen.findByRole('region', { name: 'Chest' });
    const shoulders = screen.getByRole('region', { name: 'Shoulders & Arms' });
    await waitFor(() => expect(refreshLibraryMock).toHaveBeenCalledTimes(1));
    await userEvent.click(within(chest).getByRole('button', { name: /Chest, 1 exercises/i }));
    await userEvent.click(within(shoulders).getByRole('button', { name: /Shoulders & Arms, 1 exercises/i }));
    await userEvent.click(within(chest).getByRole('button', { name: 'Archive Sample exercise' }));
    await waitFor(async () => expect((await db.exercises.get(1))?.active).toBe(false));
    resolveRefresh();
    await refreshLibraryMock.mock.results[0].value;
    await waitFor(async () => {
      expect((await db.exercises.get(1))?.active).toBe(false);
      expect(within(chest).queryByRole('heading', { name: 'Sample exercise' })).not.toBeInTheDocument();
      expect(within(shoulders).queryByRole('heading', { name: 'Sample exercise' })).not.toBeInTheDocument();
    });
    confirmSpy.mockRestore();
  });

  it('archiveRequiresConnection', async () => {
    setOnline(false);
    await db.exercises.put(exercise());
    renderLibrary();
    const chest = await screen.findByRole('region', { name: 'Chest' });
    await userEvent.click(within(chest).getByRole('button', { name: /Chest, 1 exercises/i }));
    await userEvent.click(within(chest).getByRole('button', { name: 'Archive Sample exercise' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/connection.*archive/i);
    expect(archiveExerciseMock).not.toHaveBeenCalled();
    expect(within(chest).getByRole('heading', { name: 'Sample exercise' })).toBeInTheDocument();
  });

  it('archiveFailureKeepsExerciseVisible', async () => {
    setOnline(false);
    await db.exercises.put(exercise());
    setOnline(true);
    refreshLibraryMock.mockResolvedValue(undefined);
    archiveExerciseMock.mockRejectedValue(new ApiError(500, 'failed'));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderLibrary();
    const chest = await screen.findByRole('region', { name: 'Chest' });
    await userEvent.click(within(chest).getByRole('button', { name: /Chest, 1 exercises/i }));
    await userEvent.click(within(chest).getByRole('button', { name: 'Archive Sample exercise' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't archive/i);
    expect(within(chest).getByRole('heading', { name: 'Sample exercise' })).toBeInTheDocument();
    expect((await db.exercises.get(1))?.active).not.toBe(false);
    confirmSpy.mockRestore();
  });

  it('explains when the server has no exercise generator configured', async () => {
    setOnline(true);
    refreshLibraryMock.mockResolvedValue(undefined);
    generateExerciseMock.mockRejectedValue(new ApiError(501, 'generator unavailable'));

    renderLibrary();
    await screen.findByRole('heading', { name: 'Exercise library' });
    await userEvent.click(screen.getByRole('button', { name: 'Add exercise to Back' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Exercise name' }), 'Cable row');
    await userEvent.click(screen.getByRole('button', { name: 'Create exercise' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Exercise creation isn't set up on this server yet.");
    expect(await db.exercises.count()).toBe(0);
  });
});
