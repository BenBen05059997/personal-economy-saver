CREATE TABLE "ask_receipts" (
	"household_id" uuid NOT NULL,
	"ask_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_receipts_household_id_ask_id_pk" PRIMARY KEY("household_id","ask_id")
);
--> statement-breakpoint
ALTER TABLE "ask_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "ask_receipts" ADD CONSTRAINT "ask_receipts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_period_valid" CHECK (("bills"."period_start" is null) = ("bills"."period_end" is null) and ("bills"."period_start" is null or "bills"."period_start" <= "bills"."period_end"));