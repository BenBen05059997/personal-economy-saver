CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_general" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brief_updated_at" timestamp with time zone,
	"brief_updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "spaces_name_valid" CHECK (char_length("spaces"."name") between 1 and 60),
	CONSTRAINT "spaces_status_valid" CHECK ("spaces"."status" in ('open', 'archived')),
	CONSTRAINT "spaces_general_valid" CHECK ("spaces"."is_general" = ("spaces"."name" = 'General') and (not "spaces"."is_general" or "spaces"."status" = 'open')),
	CONSTRAINT "spaces_brief_maker_valid" CHECK ("spaces"."brief_updated_by" in ('ask', 'form'))
);
--> statement-breakpoint
ALTER TABLE "spaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "standing_rules" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_household_general_uq" ON "spaces" USING btree ("household_id") WHERE "spaces"."is_general";--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_space_household_fk" FOREIGN KEY ("household_id","space_id") REFERENCES "public"."spaces"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_space_household_fk" FOREIGN KEY ("household_id","space_id") REFERENCES "public"."spaces"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_space_household_fk" FOREIGN KEY ("household_id","space_id") REFERENCES "public"."spaces"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_rules" ADD CONSTRAINT "standing_rules_space_household_fk" FOREIGN KEY ("household_id","space_id") REFERENCES "public"."spaces"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Supabase may already have installed pg_trgm in its extensions schema.
SET LOCAL search_path = public, extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "conversation_turns_question_trgm_idx" ON "conversation_turns" USING gin ("question" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "conversation_turns_reply_trgm_idx" ON "conversation_turns" USING gin ("reply" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "memories_text_trgm_idx" ON "memories" USING gin ("text" gin_trgm_ops);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.spaces TO pes_app;
--> statement-breakpoint
CREATE POLICY pes_app_household ON public.spaces FOR ALL TO pes_app
  USING (household_id = (SELECT NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (household_id = (SELECT NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
INSERT INTO public.spaces (household_id, name, is_general)
  SELECT id, 'General', true FROM public.households
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Existing workers can still create households after this migration and before the new code ships.
CREATE FUNCTION public.pes_seed_general_space() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.spaces (household_id, name, is_general) VALUES (NEW.id, 'General', true)
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pes_seed_general_space
  AFTER INSERT ON public.households
  FOR EACH ROW EXECUTE FUNCTION public.pes_seed_general_space();
