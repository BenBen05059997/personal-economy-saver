ALTER TABLE "invoices" ADD COLUMN "paypal_order_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paypal_order_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paypal_approve_url" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paypal_payee_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paypal_capture_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "pay_token" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "link_offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "connection_status" text;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "tracking_id" text;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "seller_merchant_id" text;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "paypal_email" text;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "status_detail" text;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "referral_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD COLUMN "transactions_read_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "paypal_connections_seller_connected_uq" ON "paypal_connections" USING btree ("seller_merchant_id") WHERE "paypal_connections"."connection_status" = 'connected';--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paypal_order_id_unique" UNIQUE("paypal_order_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paypal_capture_id_unique" UNIQUE("paypal_capture_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pay_token_unique" UNIQUE("pay_token");--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD CONSTRAINT "paypal_connections_tracking_id_unique" UNIQUE("tracking_id");--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD CONSTRAINT "paypal_connections_status_valid" CHECK ("paypal_connections"."connection_status" is null or "paypal_connections"."connection_status" in ('pending', 'connected'));--> statement-breakpoint
ALTER TABLE "paypal_connections" ADD CONSTRAINT "paypal_connections_connected_complete" CHECK ("paypal_connections"."connection_status" is distinct from 'connected' or ("paypal_connections"."seller_merchant_id" is not null and "paypal_connections"."connected_at" is not null));