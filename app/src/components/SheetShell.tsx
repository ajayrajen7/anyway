// A minimal bottom-sheet presentation shared by the Swap and Add-exercise
// screens (prd.md §A3.4/§A3.5) — both nested under SessionRunner via
// <Outlet/> (see App.tsx), rendered on top of the exercise being run.
import type { ReactNode } from 'react';

export default function SheetShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 max-h-[80vh] overflow-y-auto rounded-t-xl bg-surface p-4 shadow-lg">
      <div className="flex justify-end">
        <button type="button" onClick={onClose} aria-label="Close" className="px-2 text-ink-muted">
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}
