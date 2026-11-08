ALTER TABLE "ask_receipts" ADD COLUMN "pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_receipts" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;