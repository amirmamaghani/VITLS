CREATE TABLE "user_settings" (
	"owner_email" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "user_settings_owner_email_key_pk" PRIMARY KEY("owner_email","key")
);
