CREATE TABLE "expo_push_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_email" text NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"device_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "expo_push_tokens_owner_token_uq" ON "expo_push_tokens" USING btree ("owner_email","token");