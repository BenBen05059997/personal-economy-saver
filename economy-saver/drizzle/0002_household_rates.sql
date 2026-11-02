ALTER TABLE "fx_rates" DROP CONSTRAINT "fx_rates_date_base_quote_pk";--> statement-breakpoint
ALTER TABLE "fx_rates" ADD COLUMN "household_id" uuid;--> statement-breakpoint
INSERT INTO "fx_rates" ("household_id", "date", "base", "quote", "rate_micro", "created_at")
SELECT h.id, r.date, r.base, r.quote, r.rate_micro, r.created_at
FROM "households" h CROSS JOIN "fx_rates" r WHERE r.household_id IS NULL;--> statement-breakpoint
DELETE FROM "fx_rates" WHERE "household_id" IS NULL;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_household_id_date_base_quote_pk" PRIMARY KEY("household_id","date","base","quote");--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statements" ADD CONSTRAINT "card_statements_cycle_uq" UNIQUE("household_id","card_id","closed_on");