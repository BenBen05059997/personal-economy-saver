ALTER TABLE "bills" ADD COLUMN "amount_varies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "series_bill_id" uuid;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_household_id_uq" UNIQUE("household_id","id");--> statement-breakpoint
-- Only series_bill_id is cleared when the series goes (PostgreSQL 15+ column list); household_id stays. Drizzle's snapshot records "set null".
ALTER TABLE "bills" ADD CONSTRAINT "bills_series_household_fk" FOREIGN KEY ("household_id","series_bill_id") REFERENCES "public"."bills"("household_id","id") ON DELETE SET NULL ("series_bill_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bills_series_idx" ON "bills" USING btree ("household_id","series_bill_id");--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_amount_varies_monthly" CHECK (not "bills"."amount_varies" or ("bills"."repeat_unit" is not distinct from 'month' and "bills"."next_amount_minor" is null));--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_series_one_off" CHECK ("bills"."series_bill_id" is null or "bills"."repeat_unit" is null);
