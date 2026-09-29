CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "historical_metrics" ALTER COLUMN "timestamp" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "historical_metrics" ADD COLUMN "host_id" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_one_open_per_host_type" ON "alerts" USING btree ("host_id","type") WHERE "alerts"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "alerts_resolved_at_idx" ON "alerts" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "historical_metrics_host_ts_idx" ON "historical_metrics" USING btree ("host_id","timestamp" DESC NULLS LAST);