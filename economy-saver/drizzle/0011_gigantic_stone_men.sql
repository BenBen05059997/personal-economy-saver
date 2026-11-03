CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"through" date NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_amount_positive" CHECK ("settlements"."amount_minor" > 0),
	CONSTRAINT "settlements_different_members" CHECK ("settlements"."from_member_id" <> "settlements"."to_member_id")
);
--> statement-breakpoint
ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "paid_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "split_since" date;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "share_bp" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
UPDATE "members" SET "share_bp" = 10000 / c.n FROM (SELECT "household_id", count(*)::int AS n FROM "members" GROUP BY "household_id") c WHERE c."household_id" = "members"."household_id" AND c.n > 1;--> statement-breakpoint
UPDATE "members" SET "share_bp" = "share_bp" + 10000 - c.n * (10000 / c.n) FROM (SELECT "household_id", count(*)::int AS n FROM "members" GROUP BY "household_id") c WHERE c."household_id" = "members"."household_id" AND c.n > 1 AND "members"."role" = 'owner';--> statement-breakpoint
UPDATE "households" SET "split_since" = timezone("time_zone", now())::date WHERE "id" IN (SELECT "household_id" FROM "members" GROUP BY "household_id" HAVING count(*) > 1);--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "share_bp" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_household_fk" FOREIGN KEY ("household_id","from_member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_household_fk" FOREIGN KEY ("household_id","to_member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlements_household_idx" ON "settlements" USING btree ("household_id","through");--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_paid_by_household_fk" FOREIGN KEY ("household_id","paid_by_member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_paid_by_shared_only" CHECK ("bills"."paid_by_member_id" is null or "bills"."member_id" is null);--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_share_valid" CHECK ("members"."share_bp" between 0 and 10000);