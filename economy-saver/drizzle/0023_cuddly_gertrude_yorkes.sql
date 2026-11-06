ALTER TABLE "conversation_turns" DROP CONSTRAINT "conversation_turns_kind_valid";--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "repeat_until" date;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_repeat_until_valid" CHECK ("bills"."repeat_until" is null or ("bills"."repeat_unit" is not null and "bills"."due" is not null and "bills"."repeat_until" >= "bills"."due"));--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_kind_valid" CHECK ("conversation_turns"."kind" in ('answer', 'clarify', 'declined', 'document'));