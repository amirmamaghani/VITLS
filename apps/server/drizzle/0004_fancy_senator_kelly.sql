CREATE TABLE "food_names" (
	"food_id" text NOT NULL,
	"lang" text NOT NULL,
	"name" text NOT NULL,
	"search_name" text NOT NULL,
	CONSTRAINT "food_names_pk" PRIMARY KEY("food_id","lang")
);
--> statement-breakpoint
CREATE TABLE "food_nutrients" (
	"food_id" text NOT NULL,
	"nutrient" text NOT NULL,
	"amount" double precision NOT NULL,
	CONSTRAINT "food_nutrients_pk" PRIMARY KEY("food_id","nutrient")
);
--> statement-breakpoint
CREATE TABLE "food_portions" (
	"food_id" text NOT NULL,
	"label" text NOT NULL,
	"amount" double precision NOT NULL,
	CONSTRAINT "food_portions_pk" PRIMARY KEY("food_id","label")
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"barcode" text,
	"basis" text DEFAULT '100g' NOT NULL,
	"created_by" text,
	"refreshed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_items" (
	"id" text PRIMARY KEY NOT NULL,
	"meal_id" text NOT NULL,
	"position" integer NOT NULL,
	"food_id" text,
	"name" text,
	"amount" double precision NOT NULL,
	"unit" text NOT NULL,
	"nutrients" text NOT NULL,
	"estimated" integer DEFAULT 0 NOT NULL,
	"owner_email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" text PRIMARY KEY NOT NULL,
	"eaten_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"meal_type" text,
	"note" text,
	"entry" text NOT NULL,
	"source" text DEFAULT 'vitls' NOT NULL,
	"external_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"owner_email" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "foods_source_ref_uq" ON "foods" USING btree ("source","source_ref");--> statement-breakpoint
CREATE INDEX "foods_barcode_idx" ON "foods" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "meal_items_meal_idx" ON "meal_items" USING btree ("meal_id");--> statement-breakpoint
CREATE INDEX "meals_owner_date_idx" ON "meals" USING btree ("owner_email","local_date");