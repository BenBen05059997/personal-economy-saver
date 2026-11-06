CREATE TYPE "public"."memory_kind" AS ENUM('fact', 'preference', 'goal', 'instruction', 'correction');--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"text" text NOT NULL,
	"made_by" "made_by" DEFAULT 'form' NOT NULL,
	"ask_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_text_valid" CHECK (char_length("memories"."text") between 1 and 400)
);
--> statement-breakpoint
ALTER TABLE "memories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_household_idx" ON "memories" USING btree ("household_id");