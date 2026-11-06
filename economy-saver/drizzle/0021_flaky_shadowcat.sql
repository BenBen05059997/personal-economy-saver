CREATE TABLE "canvases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"recipe" jsonb NOT NULL,
	"position" integer NOT NULL,
	"made_by" "made_by" DEFAULT 'form' NOT NULL,
	"ask_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvases_title_valid" CHECK (char_length("canvases"."title") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "canvases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"question" text NOT NULL,
	"kind" text NOT NULL,
	"reply" text NOT NULL,
	"choices" jsonb,
	"recipe" jsonb,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thumb" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_turns_question_valid" CHECK (char_length("conversation_turns"."question") between 1 and 320),
	CONSTRAINT "conversation_turns_kind_valid" CHECK ("conversation_turns"."kind" in ('answer', 'clarify', 'declined')),
	CONSTRAINT "conversation_turns_thumb_valid" CHECK ("conversation_turns"."thumb" is null or "conversation_turns"."thumb" in (-1, 1))
);
--> statement-breakpoint
ALTER TABLE "conversation_turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "ai_provider" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "ai_protocol" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "ai_base_url" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "ai_text_model" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "ai_document_model" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "ai_check" jsonb;--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvases_household_position_idx" ON "canvases" USING btree ("household_id","position");--> statement-breakpoint
CREATE INDEX "conversation_turns_household_idx" ON "conversation_turns" USING btree ("household_id","conversation_id","created_at");--> statement-breakpoint
UPDATE "households" SET "ai_provider" = 'anthropic', "ai_protocol" = 'anthropic', "ai_base_url" = 'https://api.anthropic.com' WHERE "ai_key_secret_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_ai_protocol_valid" CHECK ("households"."ai_protocol" is null or "households"."ai_protocol" in ('anthropic', 'openai'));--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_ai_endpoint_together" CHECK (("households"."ai_provider" is null and "households"."ai_protocol" is null and "households"."ai_base_url" is null) or ("households"."ai_provider" is not null and "households"."ai_protocol" is not null and "households"."ai_base_url" is not null));