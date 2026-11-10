CREATE TABLE "own_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"business_bp" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "own_categories_name_uq" UNIQUE("household_id","kind","name_key"),
	CONSTRAINT "own_categories_household_id_uq" UNIQUE("household_id","id","kind"),
	CONSTRAINT "own_categories_kind_valid" CHECK ("own_categories"."kind" in ('housing', 'utilities', 'phone_internet', 'subscriptions', 'food', 'transport', 'travel', 'health', 'insurance', 'family_shared', 'government_tax', 'business_tools', 'debt', 'other')),
	CONSTRAINT "own_categories_name_valid" CHECK (char_length("own_categories"."name") between 1 and 40),
	CONSTRAINT "own_categories_business_valid" CHECK ("own_categories"."business_bp" is null or "own_categories"."business_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "own_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "own_category_id" uuid;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "own_category_id" uuid;--> statement-breakpoint
ALTER TABLE "own_categories" ADD CONSTRAINT "own_categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "own_categories_household_idx" ON "own_categories" USING btree ("household_id");--> statement-breakpoint
-- Only own_category_id is cleared when an own category is removed (PostgreSQL 15+ column list); household_id and category stay. Drizzle's snapshot records "set null".
ALTER TABLE "bills" ADD CONSTRAINT "bills_own_category_fk" FOREIGN KEY ("household_id","own_category_id","category") REFERENCES "public"."own_categories"("household_id","id","kind") ON DELETE SET NULL ("own_category_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_own_category_fk" FOREIGN KEY ("household_id","own_category_id","category") REFERENCES "public"."own_categories"("household_id","id","kind") ON DELETE SET NULL ("own_category_id") ON UPDATE no action;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.own_categories TO pes_app;
--> statement-breakpoint
CREATE POLICY pes_app_household ON public.own_categories FOR ALL TO pes_app
  USING (household_id = (SELECT NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (household_id = (SELECT NULLIF(current_setting('app.household_id', true), '')::uuid));
