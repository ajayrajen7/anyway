// Persistent bottom nav — Today / Week / Coverage / Library, matching
// the owner's reference screenshot's order and labels — wraps the four
// "browse any time" screens (see App.tsx). Session, Add, Swap, the summary,
// morning check, and settings stay outside it: they're full-screen flows
// you enter and leave, not places to idly switch between.
import { NavLink, Outlet } from 'react-router-dom';

// Route paths stay descriptive; labels are short enough for the mobile nav.
const TABS = [
  { to: '/', label: 'Today', icon: '🏠', end: true },
  { to: '/week', label: 'Week', icon: '📅', end: false },
  { to: '/coverage', label: 'Coverage', icon: '📊', end: false },
  { to: '/library', label: 'Library', icon: '📚', end: false },
] as const;

export default function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <div className="flex-1 pb-20">
        <Outlet />
      </div>
      <nav className="fixed inset-x-0 bottom-0 flex border-t border-border bg-surface">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'text-accent' : 'text-ink-muted'}`
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
