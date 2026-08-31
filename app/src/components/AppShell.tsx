// UX refactor: a persistent bottom nav — Today / Coverage / Week Plan —
// wraps the three "browse any time" screens (see App.tsx). Session, Add,
// Swap, the summary, morning check, and settings stay outside it: they're
// full-screen flows you enter and leave, not places to idly switch between.
import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Today', icon: '🏠', end: true },
  { to: '/coverage', label: 'Coverage', icon: '📊', end: false },
  { to: '/week', label: 'Week Plan', icon: '📅', end: false },
] as const;

export default function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 pb-16">
        <Outlet />
      </div>
      <nav className="fixed inset-x-0 bottom-0 flex border-t border-slate-800 bg-slate-950">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'text-emerald-500' : 'text-slate-500'}`
            }
          >
            <span className="text-lg" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
