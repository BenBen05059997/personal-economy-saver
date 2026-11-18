ALTER TABLE "charges" ADD CONSTRAINT "charges_household_id_uq" UNIQUE("household_id","id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_household_id_uq" UNIQUE("household_id","id");--> statement-breakpoint
CREATE TABLE "choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid,
	"source" text NOT NULL,
	"happened_on" date NOT NULL,
	"about_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"words" text NOT NULL,
	"category" text,
	"found_key" text,
	"status" "confirm_status" DEFAULT 'confirmed' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"made_by" "made_by" DEFAULT 'form' NOT NULL,
	"ask_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "choices_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "choices_source_valid" CHECK ("choices"."source" in ('said', 'found')),
	CONSTRAINT "choices_about_positive" CHECK ("choices"."about_minor" > 0),
	CONSTRAINT "choices_words_valid" CHECK (char_length("choices"."words") between 1 and 160),
	CONSTRAINT "choices_category_valid" CHECK ("choices"."category" is null or "choices"."category" in ('housing', 'utilities', 'phone_internet', 'subscriptions', 'food', 'transport', 'travel', 'health', 'insurance', 'family_shared', 'government_tax', 'business_tools', 'debt', 'other')),
	CONSTRAINT "choices_found_key_valid" CHECK (("choices"."found_key" is not null) = ("choices"."source" = 'found')),
	CONSTRAINT "choices_confirmed_valid" CHECK (("choices"."confirmed_at" is not null) = ("choices"."status" = 'confirmed')),
	CONSTRAINT "choices_withdrawn_valid" CHECK ("choices"."withdrawn_at" is null or "choices"."status" = 'confirmed')
);
--> statement-breakpoint
ALTER TABLE "choices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pot_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"pot_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"moved_on" date,
	"reason" text,
	"member_id" uuid,
	"invoice_id" uuid,
	"charge_id" uuid,
	"bill_id" uuid,
	"bill_on" date,
	"choice_id" uuid,
	"pair_id" uuid,
	"status" "confirm_status" DEFAULT 'confirmed' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"made_by" "made_by" DEFAULT 'form' NOT NULL,
	"ask_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pot_moves_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "pot_moves_kind_valid" CHECK ("pot_moves"."kind" in ('adjust', 'fill', 'add', 'take_out', 'spend', 'carry')),
	CONSTRAINT "pot_moves_sign_valid" CHECK (("pot_moves"."kind" in ('fill', 'add') and "pot_moves"."amount_minor" > 0) or ("pot_moves"."kind" in ('take_out', 'spend') and "pot_moves"."amount_minor" < 0) or ("pot_moves"."kind" in ('adjust', 'carry') and "pot_moves"."amount_minor" <> 0)),
	CONSTRAINT "pot_moves_one_link" CHECK (num_nonnulls("pot_moves"."invoice_id", "pot_moves"."charge_id", "pot_moves"."bill_id", "pot_moves"."choice_id", "pot_moves"."pair_id") <= 1),
	CONSTRAINT "pot_moves_link_kind" CHECK (("pot_moves"."invoice_id" is null or "pot_moves"."kind" = 'fill') and (("pot_moves"."charge_id" is null and "pot_moves"."bill_id" is null) or "pot_moves"."kind" = 'spend') and ("pot_moves"."choice_id" is null or "pot_moves"."kind" = 'add') and (("pot_moves"."pair_id" is not null) = ("pot_moves"."kind" = 'carry')) and ("pot_moves"."bill_id" is null or "pot_moves"."bill_on" is not null)),
	CONSTRAINT "pot_moves_confirmed_valid" CHECK (("pot_moves"."confirmed_at" is not null) = ("pot_moves"."status" = 'confirmed') and ("pot_moves"."moved_on" is not null) = ("pot_moves"."status" = 'confirmed')),
	CONSTRAINT "pot_moves_pending_kind" CHECK ("pot_moves"."status" = 'confirmed' or "pot_moves"."kind" not in ('adjust', 'fill')),
	CONSTRAINT "pot_moves_reason_valid" CHECK ("pot_moves"."reason" is null or char_length("pot_moves"."reason") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "pot_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "standing_rules" DROP CONSTRAINT "standing_rules_kind_valid";--> statement-breakpoint
ALTER TABLE "pots" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "pots" ADD COLUMN "done_on" date;--> statement-breakpoint
ALTER TABLE "choices" ADD CONSTRAINT "choices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "choices" ADD CONSTRAINT "choices_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "choices" ADD CONSTRAINT "choices_member_household_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_choice_id_choices_id_fk" FOREIGN KEY ("choice_id") REFERENCES "public"."choices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_pot_household_fk" FOREIGN KEY ("household_id","pot_id") REFERENCES "public"."pots"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_member_household_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_invoice_household_fk" FOREIGN KEY ("household_id","invoice_id") REFERENCES "public"."invoices"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_charge_household_fk" FOREIGN KEY ("household_id","charge_id") REFERENCES "public"."charges"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_bill_household_fk" FOREIGN KEY ("household_id","bill_id") REFERENCES "public"."bills"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_moves" ADD CONSTRAINT "pot_moves_choice_household_fk" FOREIGN KEY ("household_id","choice_id") REFERENCES "public"."choices"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "choices_household_idx" ON "choices" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "choices_found_key_uq" ON "choices" USING btree ("household_id","found_key") WHERE "choices"."found_key" is not null;--> statement-breakpoint
CREATE INDEX "pot_moves_household_idx" ON "pot_moves" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "pot_moves_pot_idx" ON "pot_moves" USING btree ("household_id","pot_id","moved_on");--> statement-breakpoint
CREATE UNIQUE INDEX "pot_moves_fill_invoice_uq" ON "pot_moves" USING btree ("household_id","pot_id","invoice_id") WHERE "pot_moves"."kind" = 'fill' and "pot_moves"."invoice_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pot_moves_spend_charge_uq" ON "pot_moves" USING btree ("household_id","pot_id","charge_id") WHERE "pot_moves"."kind" = 'spend' and "pot_moves"."charge_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pot_moves_spend_bill_uq" ON "pot_moves" USING btree ("household_id","pot_id","bill_id","bill_on") WHERE "pot_moves"."kind" = 'spend' and "pot_moves"."bill_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pot_moves_carry_uq" ON "pot_moves" USING btree ("household_id","pair_id","pot_id") WHERE "pot_moves"."kind" = 'carry';--> statement-breakpoint
ALTER TABLE "pots" ADD CONSTRAINT "pots_category_valid" CHECK ("pots"."category" is null or "pots"."category" in ('housing', 'utilities', 'phone_internet', 'subscriptions', 'food', 'transport', 'travel', 'health', 'insurance', 'family_shared', 'government_tax', 'business_tools', 'debt', 'other'));--> statement-breakpoint
ALTER TABLE "standing_rules" ADD CONSTRAINT "standing_rules_kind_valid" CHECK ("standing_rules"."kind" in ('nudge_after', 'statement_ahead', 'bill_ahead', 'cost_up', 'safe_below', 'goal_behind', 'saving_wins'));
--> statement-breakpoint
-- Hand-added tail, kept as written. Both new tables get the household policy (0032's wording).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.choices TO pes_app;
--> statement-breakpoint
CREATE POLICY pes_app_household ON public.choices FOR ALL TO pes_app
  USING (household_id = (SELECT NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (household_id = (SELECT NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pot_moves TO pes_app;
--> statement-breakpoint
CREATE POLICY pes_app_household ON public.pot_moves FOR ALL TO pes_app
  USING (household_id = (SELECT NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (household_id = (SELECT NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
UPDATE "pots" SET "category" = 'government_tax' WHERE "fill_bp" IS NOT NULL AND "category" IS NULL;
--> statement-breakpoint
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
