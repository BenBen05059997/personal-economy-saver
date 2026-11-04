ALTER TABLE "households" ADD COLUMN "fixed_today" date;--> statement-breakpoint
UPDATE "households" SET "fixed_today" = '2026-11-14' WHERE "is_demo";
