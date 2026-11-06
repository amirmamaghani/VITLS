CREATE TABLE "data_shares" (
	"owner_email" text NOT NULL,
	"grantee_email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" text NOT NULL,
	"revoked_at" text,
	CONSTRAINT "data_shares_owner_email_grantee_email_pk" PRIMARY KEY("owner_email","grantee_email")
);
--> statement-breakpoint
CREATE INDEX "data_shares_grantee_idx" ON "data_shares" USING btree ("grantee_email");