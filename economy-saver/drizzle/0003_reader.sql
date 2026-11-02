ALTER TABLE "bills" ADD COLUMN "fx_rate_micro" bigint;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "forwarding_localpart" text;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_household_biller_uq" UNIQUE("household_id","match_biller");