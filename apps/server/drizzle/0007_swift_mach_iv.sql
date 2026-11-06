CREATE TABLE "coach_memories" (
	"owner_email" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"content" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "coach_memories_owner_email_name_pk" PRIMARY KEY("owner_email","name")
);
--> statement-breakpoint
CREATE INDEX "coach_memories_owner_idx" ON "coach_memories" USING btree ("owner_email");