ALTER TABLE "households" ADD COLUMN "memory_place" text DEFAULT 'cloud' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "journal_place" text DEFAULT 'cloud' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "canvas_place" text DEFAULT 'cloud' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_memory_place_valid" CHECK ("households"."memory_place" in ('cloud', 'device'));--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_journal_place_valid" CHECK ("households"."journal_place" in ('cloud', 'device'));--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_canvas_place_valid" CHECK ("households"."canvas_place" in ('cloud', 'device'));