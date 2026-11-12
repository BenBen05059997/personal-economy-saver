ALTER TABLE "invoices" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payer_member_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "owed_minor" bigint;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payer_member_fk" FOREIGN KEY ("household_id","payer_member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_xor_member" CHECK (("invoices"."client_id" is null) <> ("invoices"."payer_member_id" is null));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_owed_with_member" CHECK (("invoices"."payer_member_id" is null) = ("invoices"."owed_minor" is null));