CREATE TABLE "ai_global_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_global_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ip_buckets" (
	"ip_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"window" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "ip_buckets_ip_hash_purpose_pk" PRIMARY KEY("ip_hash","purpose")
);
--> statement-breakpoint
ALTER TABLE "ip_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_removed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "webhook_deliveries" SET "payload" = jsonb_build_object('invoiceId', "payload"->'invoiceId', 'createdAt', "payload"->'createdAt');
