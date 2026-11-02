ALTER TABLE "households" ADD COLUMN "runway_short" boolean;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "notification_day" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paypal_status" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paypal_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "refresh_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "refresh_error" text;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "balance_as_of" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "latest_credit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "balance_fx_rate_micro" bigint;--> statement-breakpoint
UPDATE "paypal_connections" AS pc
SET "latest_credit_at" = (
  SELECT max(e."occurred_at") FROM "events" AS e
  WHERE e."household_id" = pc."household_id" AND e."kind" = 'invoice_paid'
);--> statement-breakpoint
UPDATE "households" AS h
SET "notification_day" = (
  SELECT max(timezone(h."time_zone", e."created_at")::date) FROM "events" AS e
  WHERE e."household_id" = h."id" AND e."notify" AND e."kind" <> 'invoice_paid'
);
