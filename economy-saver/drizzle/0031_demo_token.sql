ALTER TABLE "households" ADD COLUMN "demo_token_hash" text;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_demo_token_hash_unique" UNIQUE("demo_token_hash");