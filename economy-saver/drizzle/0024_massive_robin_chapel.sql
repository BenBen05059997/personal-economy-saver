ALTER TABLE "cards" ADD COLUMN "foreign_fee_bp" integer;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "fx_estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_foreign_fee_valid" CHECK ("cards"."foreign_fee_bp" is null or ("cards"."foreign_fee_bp" between 0 and 1000));