CREATE TABLE "balance_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "confirm_status" DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_updates_household_id_uq" UNIQUE("household_id","id")
);
--> statement-breakpoint
ALTER TABLE "balance_updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "balance_updates" ADD CONSTRAINT "balance_updates_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_updates_household_idx" ON "balance_updates" USING btree ("household_id");