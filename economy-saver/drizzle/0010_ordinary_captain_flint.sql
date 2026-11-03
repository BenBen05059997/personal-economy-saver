CREATE TABLE "pots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid,
	"name" text NOT NULL,
	"target_minor" bigint,
	"target_date" date,
	"saved_minor" bigint DEFAULT 0 NOT NULL,
	"fill_bp" integer,
	"currency" char(3) NOT NULL,
	"status" "confirm_status" DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pots_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "pots_name_valid" CHECK (char_length("pots"."name") between 1 and 60),
	CONSTRAINT "pots_target_positive" CHECK ("pots"."target_minor" is null or "pots"."target_minor" > 0),
	CONSTRAINT "pots_saved_valid" CHECK ("pots"."saved_minor" >= 0),
	CONSTRAINT "pots_fill_valid" CHECK ("pots"."fill_bp" is null or "pots"."fill_bp" between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "pots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pots" ADD CONSTRAINT "pots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pots" ADD CONSTRAINT "pots_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pots" ADD CONSTRAINT "pots_member_household_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pots_household_idx" ON "pots" USING btree ("household_id");