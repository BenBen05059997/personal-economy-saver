ALTER TABLE "bills" ADD COLUMN "repeat_unit" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "next_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "next_amount_from" date;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "cancel_by" date;--> statement-breakpoint
UPDATE "bills" SET "repeat_unit" = 'month' WHERE "repeat_day" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_repeat_unit_valid" CHECK ("bills"."repeat_unit" is null or "bills"."repeat_unit" in ('month', 'year'));--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_repeat_day_monthly" CHECK (("bills"."repeat_unit" is not distinct from 'month') = ("bills"."repeat_day" is not null));--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_next_amount_pair" CHECK (("bills"."next_amount_minor" is null) = ("bills"."next_amount_from" is null));