ALTER TABLE "reminder_settings" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "email_ran_on" date;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "push_ran_on" date;