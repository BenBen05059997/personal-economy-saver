ALTER TABLE "invoices" ADD COLUMN "reminder_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reminded_at" timestamp with time zone;