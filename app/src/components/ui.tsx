// Shared visual components (UX redesign, M12) — a small design-system layer
// so Today, the session screens, Coverage, and Week Plan read as one
// consistent app instead of four independently-styled screens. Built to
// match the owner's reference screenshots: dark cards a shade lighter than
// the page background, an orange accent for primary actions/active state,
// pill-style tags, a thin progress bar. See index.css's @theme block for
// the actual color values these classes resolve to.
//
// Presentation only — no logic lives here. Every screen that used to inline
// `rounded-md bg-slate-800 ...` now reaches for one of these instead.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-surface p-4 ${className}`}>{children}</div>;
}

// A small rounded tag — muscle-group weights ("GLUTES 1.0"), status labels,
// anything that reads as a short label rather than a sentence.
export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' }) {
  const toneClass = tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-surface-alt text-ink-muted';
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${toneClass}`}>{children}</span>;
}

// value/max as a 0..1 fraction of an accent-filled bar over a muted track —
// e.g. "exercise 3 of 7" on the session screen.
export function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt" role="presentation">
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

// Exported as plain class strings too, not just the <button> components
// below, so a react-router <Link> that needs to *look* like a primary/
// secondary action (e.g. Today's "Start session") can share the exact same
// styling without being forced into a <button>.
export const primaryButtonClass = 'inline-block rounded-xl bg-accent px-4 py-3 text-center font-medium text-white disabled:opacity-40';
export const secondaryButtonClass = 'inline-block rounded-xl bg-surface-alt px-4 py-3 text-center font-medium text-ink disabled:opacity-40';

// The one filled/accent button per screen — "Start session", "Next", "Done".
export function PrimaryButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`${primaryButtonClass} ${className}`} />;
}

// Everything else that's tappable but not the primary action — "Swap",
// "Skip", the −/+ steppers, a list row that navigates somewhere.
export function SecondaryButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`${secondaryButtonClass} ${className}`} />;
}

// A small filled/outline dot — Week Plan's per-day status, Coverage's pain
// strip. `tone` picks the fill; an unfilled dot (nothing logged yet) passes
// tone="none".
const DOT_TONE: Record<'accent' | 'muted' | 'none', string> = {
  accent: 'bg-accent',
  muted: 'bg-ink-muted',
  none: 'bg-surface-alt',
};
export function StatusDot({ tone }: { tone: 'accent' | 'muted' | 'none' }) {
  return <span className={`inline-block h-3 w-3 rounded-full ${DOT_TONE[tone]}`} aria-hidden="true" />;
}
