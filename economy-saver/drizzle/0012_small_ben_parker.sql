ALTER TABLE "bills" ADD COLUMN "business_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "category" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "business_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "bills" SET "category" = CASE "category" WHEN 'Housing' THEN 'housing' WHEN 'Phone' THEN 'phone_internet' WHEN 'Subscriptions' THEN 'subscriptions' WHEN 'Utilities · Electricity' THEN 'utilities' ELSE 'other' END;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_category_valid" CHECK ("bills"."category" in ('housing', 'utilities', 'phone_internet', 'subscriptions', 'food', 'transport', 'health', 'insurance', 'family_shared', 'government_tax', 'business_tools', 'debt', 'other'));--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_business_valid" CHECK ("bills"."business_bp" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_category_valid" CHECK ("charges"."category" in ('housing', 'utilities', 'phone_internet', 'subscriptions', 'food', 'transport', 'health', 'insurance', 'family_shared', 'government_tax', 'business_tools', 'debt', 'other'));--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_business_valid" CHECK ("charges"."business_bp" between 0 and 10000);