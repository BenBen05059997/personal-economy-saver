CREATE TABLE "request_buckets" (
	"household_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"window" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "request_buckets_household_id_purpose_pk" PRIMARY KEY("household_id","purpose")
);
--> statement-breakpoint
ALTER TABLE "request_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "request_buckets" ADD CONSTRAINT "request_buckets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;