CREATE TABLE "daily_metrics" (
	"source_id" text NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"external_id" text,
	"updated_at" text NOT NULL,
	"owner_email" text NOT NULL,
	CONSTRAINT "daily_metrics_pk" PRIMARY KEY("owner_email","source_id","metric","day")
);
--> statement-breakpoint
CREATE TABLE "device_pairings" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	"created_at" text NOT NULL,
	"owner_email" text NOT NULL,
	CONSTRAINT "device_pairings_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"label" text,
	"platform" text,
	"scope" text DEFAULT 'ingest:write' NOT NULL,
	"created_at" text NOT NULL,
	"last_used_at" text,
	"revoked_at" text,
	"owner_email" text NOT NULL,
	CONSTRAINT "device_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "health_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"via" text NOT NULL,
	"device_token_id" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" text,
	"created_at" text NOT NULL,
	"owner_email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"source_id" text NOT NULL,
	"received_at" text NOT NULL,
	"counts" text NOT NULL,
	"raw" text,
	"raw_expires_at" text,
	"owner_email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intraday_series" (
	"source_id" text NOT NULL,
	"metric" text NOT NULL,
	"day" date NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"interval_s" integer NOT NULL,
	"values" text NOT NULL,
	"updated_at" text NOT NULL,
	"owner_email" text NOT NULL,
	CONSTRAINT "intraday_series_pk" PRIMARY KEY("owner_email","source_id","metric","start_at")
);
--> statement-breakpoint
CREATE TABLE "point_metrics" (
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"zone_offset" text,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"updated_at" text NOT NULL,
	"owner_email" text NOT NULL,
	CONSTRAINT "point_metrics_pk" PRIMARY KEY("owner_email","source_id","external_id","at")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"count" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sleep_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"duration_s" integer NOT NULL,
	"stages" text,
	"scores" text,
	"updated_at" text NOT NULL,
	"owner_email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"distance_m" double precision,
	"energy_kcal" double precision,
	"avg_hr" double precision,
	"max_hr" double precision,
	"pool_length_m" double precision,
	"strokes" integer,
	"zones" text,
	"sets" text,
	"updated_at" text NOT NULL,
	"owner_email" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "daily_metrics_owner_metric_day_idx" ON "daily_metrics" USING btree ("owner_email","metric","day");--> statement-breakpoint
CREATE UNIQUE INDEX "health_sources_device_uq" ON "health_sources" USING btree ("owner_email","device_token_id","provider","via");--> statement-breakpoint
CREATE UNIQUE INDEX "health_sources_provider_uq" ON "health_sources" USING btree ("owner_email","provider","via");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_batches_uq" ON "ingest_batches" USING btree ("owner_email","batch_id");--> statement-breakpoint
CREATE INDEX "intraday_series_owner_metric_day_idx" ON "intraday_series" USING btree ("owner_email","metric","day");--> statement-breakpoint
CREATE INDEX "point_metrics_owner_metric_at_idx" ON "point_metrics" USING btree ("owner_email","metric","at");--> statement-breakpoint
CREATE UNIQUE INDEX "sleep_sessions_uq" ON "sleep_sessions" USING btree ("owner_email","source_id","external_id");--> statement-breakpoint
CREATE INDEX "sleep_sessions_owner_start_idx" ON "sleep_sessions" USING btree ("owner_email","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workouts_uq" ON "workouts" USING btree ("owner_email","source_id","external_id");--> statement-breakpoint
CREATE INDEX "workouts_owner_start_idx" ON "workouts" USING btree ("owner_email","start_at");