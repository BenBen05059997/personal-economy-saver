CREATE TYPE "public"."made_by" AS ENUM('form', 'ask', 'mcp', 'reader', 'cron', 'paypal', 'import');--> statement-breakpoint
ALTER TABLE "balance_updates" ADD COLUMN "made_by" "made_by" DEFAULT 'form' NOT NULL;--> statement-breakpoint
ALTER TABLE "balance_updates" ADD COLUMN "ask_id" uuid;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "made_by" "made_by" DEFAULT 'form' NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "ask_id" uuid;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "made_by" "made_by" DEFAULT 'form' NOT NULL;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "ask_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "made_by" "made_by" DEFAULT 'form' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ask_id" uuid;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "nudge_after_days" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "made_by" "made_by" DEFAULT 'form' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ask_id" uuid;--> statement-breakpoint
ALTER TABLE "pots" ADD COLUMN "made_by" "made_by" DEFAULT 'form' NOT NULL;--> statement-breakpoint
ALTER TABLE "pots" ADD COLUMN "ask_id" uuid;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_nudge_after_days_valid" CHECK ("households"."nudge_after_days" is null or "households"."nudge_after_days" between 1 and 60);