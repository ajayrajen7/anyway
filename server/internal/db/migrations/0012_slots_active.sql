-- Reconciling actual performance back into `slots` (post-M12 "this week's
-- actual plan becomes next week's base" — see server/internal/sync#ReconcileSlots)
-- needs a way to retire a slot the user explicitly deleted from a session
-- without a real DELETE: `logged_sets.slot_id` is FK-enforced
-- (db.go's `_pragma=foreign_keys(1)`), and a slot can already be referenced
-- by *past* sessions' logged_sets rows, so deleting it would either fail
-- outright or orphan that history. `active = 0` retires it instead —
-- internal/today and internal/phase only ever serve `active = 1` slots.
ALTER TABLE slots ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
