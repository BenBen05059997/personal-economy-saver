-- Hand-written, kept as written: reruns 0036's backfill once after the code that keeps moves is live, so a fill or pot
-- edit the old code made between 0036 and the deploy gets its move. Each step is safe to run again.
-- B1: fills from pot_filled events; the move takes the event's id, so a rerun never inserts twice
INSERT INTO "pot_moves" ("id","household_id","pot_id","kind","amount_minor","currency","moved_on","status","confirmed_at","invoice_id","made_by","created_at")
SELECT e.id, e.household_id, p.id, 'fill', e.amount_minor, p.currency, (timezone(h.time_zone, e.occurred_at))::date, 'confirmed', e.created_at,
  (SELECT min(i.ref_id::text)::uuid FROM events i JOIN invoices v ON v.household_id = i.household_id AND v.id = i.ref_id
    WHERE i.household_id = e.household_id AND i.created_at = e.created_at AND i.ref_type = 'invoice'
      AND i.kind IN ('invoice_paid','invoice_paid_outside','payment_received') HAVING count(DISTINCT i.ref_id) = 1),
  e.made_by, e.created_at
FROM events e JOIN pots p ON p.household_id = e.household_id AND p.id = e.ref_id JOIN households h ON h.id = e.household_id
WHERE e.kind = 'pot_filled' AND e.ref_type = 'pot' AND e.amount_minor > 0 AND p.status = 'confirmed'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- B2: one adjust per confirmed pot so its moves add up to saved_minor
INSERT INTO "pot_moves" ("household_id","pot_id","kind","amount_minor","currency","moved_on","status","confirmed_at")
SELECT p.household_id, p.id, 'adjust', p.saved_minor - coalesce(m.total, 0), p.currency,
  coalesce(h.fixed_today, (timezone(h.time_zone, now()))::date), 'confirmed', now()
FROM pots p JOIN households h ON h.id = p.household_id
LEFT JOIN (SELECT household_id, pot_id, sum(amount_minor) AS total FROM pot_moves WHERE status = 'confirmed' GROUP BY 1, 2) m
  ON m.household_id = p.household_id AND m.pot_id = p.id
WHERE p.status = 'confirmed' AND p.saved_minor <> coalesce(m.total, 0);
--> statement-breakpoint
-- B3: the new rule
INSERT INTO "standing_rules" ("household_id","kind","enabled") SELECT DISTINCT household_id, 'saving_wins', true FROM standing_rules
ON CONFLICT ("household_id","kind") DO NOTHING;
