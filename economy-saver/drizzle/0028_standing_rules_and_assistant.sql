CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_household_id_uq" UNIQUE("household_id","id")
);
--> statement-breakpoint
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "push_subscriptions_household_endpoint_uq" UNIQUE("household_id","endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reminder_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"hour" integer DEFAULT 8 NOT NULL,
	"quiet_days" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"email_on" boolean DEFAULT false NOT NULL,
	"email" text,
	"email_ran_on" date,
	"push_ran_on" date,
	CONSTRAINT "reminder_settings_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "reminder_settings_household_member_uq" UNIQUE("household_id","member_id"),
	CONSTRAINT "reminder_settings_hour_valid" CHECK ("reminder_settings"."hour" between 0 and 23)
);
--> statement-breakpoint
ALTER TABLE "reminder_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"day" date NOT NULL,
	"suggestion_ids" uuid[] NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "reminders_household_member_channel_day_uq" UNIQUE("household_id","member_id","channel","day"),
	CONSTRAINT "reminders_channel_valid" CHECK ("reminders"."channel" in ('email', 'push')),
	CONSTRAINT "reminders_status_valid" CHECK ("reminders"."status" in ('sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "standing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean NOT NULL,
	"threshold" bigint,
	"currency" char(3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_rules_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "standing_rules_household_kind_uq" UNIQUE("household_id","kind"),
	CONSTRAINT "standing_rules_kind_valid" CHECK ("standing_rules"."kind" in ('nudge_after', 'statement_ahead', 'bill_ahead', 'cost_up', 'safe_below', 'goal_behind'))
);
--> statement-breakpoint
ALTER TABLE "standing_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"action" text NOT NULL,
	"ref_id" text,
	"urgency" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snoozed_on" date,
	"closed_at" timestamp with time zone,
	CONSTRAINT "suggestions_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "suggestions_household_key_uq" UNIQUE("household_id","key"),
	CONSTRAINT "suggestions_status_valid" CHECK ("suggestions"."status" in ('open', 'approved', 'dismissed', 'not_now', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "daily_ran_on" date;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_member_household_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_creator_household_fk" FOREIGN KEY ("household_id","created_by_member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_member_household_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_member_household_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_member_household_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_rules" ADD CONSTRAINT "standing_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_household_member_idx" ON "invites" USING btree ("household_id","member_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_household_member_idx" ON "push_subscriptions" USING btree ("household_id","member_id");--> statement-breakpoint
CREATE INDEX "suggestions_household_status_idx" ON "suggestions" USING btree ("household_id","status");
--> statement-breakpoint
INSERT INTO "standing_rules" ("household_id", "kind", "enabled", "threshold")
SELECT h."id", r.kind,
  CASE WHEN r.kind = 'nudge_after' THEN h."nudge_after_days" IS NOT NULL ELSE r.enabled END,
  CASE WHEN r.kind = 'nudge_after' THEN h."nudge_after_days" ELSE r.threshold END
FROM "households" h
CROSS JOIN (VALUES
  ('nudge_after', true, 3),
  ('statement_ahead', true, 3),
  ('bill_ahead', true, 3),
  ('cost_up', false, NULL),
  ('safe_below', false, NULL),
  ('goal_behind', true, NULL)
) AS r(kind, enabled, threshold);
