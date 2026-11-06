CREATE TABLE "vitls_dashboard_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"dashboard_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"config" text NOT NULL,
	"owner_email" text NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"chat_context" text
);
--> statement-breakpoint
CREATE TABLE "vitls_dashboards" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"config" text NOT NULL,
	"owner_email" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"archived_at" text
);
--> statement-breakpoint
CREATE INDEX "vitls_dashboard_revisions_dashboard_idx" ON "vitls_dashboard_revisions" USING btree ("dashboard_id","created_at");