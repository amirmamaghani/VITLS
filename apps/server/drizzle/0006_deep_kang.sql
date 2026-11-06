CREATE TABLE "chat_threads" (
	"owner_email" text NOT NULL,
	"dashboard_id" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text,
	"updated_at" text,
	CONSTRAINT "chat_threads_owner_email_dashboard_id_pk" PRIMARY KEY("owner_email","dashboard_id")
);
