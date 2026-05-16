-- Breaking change: Autopilot has been replaced by Flows.
DROP TABLE IF EXISTS "autopilot_runs";
DROP TABLE IF EXISTS "autopilot_tasks";
DROP TYPE IF EXISTS "AutopilotRunTrigger";
DROP TYPE IF EXISTS "AutopilotRunStatus";

-- Flow soft delete and active-name uniqueness.
ALTER TABLE "flows" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "flows" DROP COLUMN IF EXISTS "slack_notification_config";
DROP INDEX IF EXISTS "flows_user_id_name_key";
CREATE INDEX "flows_user_id_name_idx" ON "flows"("user_id", "name");
CREATE UNIQUE INDEX "flows_user_id_name_active_key"
  ON "flows"("user_id", "name")
  WHERE "deleted_at" IS NULL;

-- Per-run retry metadata.
ALTER TABLE "flow_runs" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "flow_runs" ADD COLUMN "retry_scheduled_for" TIMESTAMP(3);
ALTER TABLE "flow_runs" ADD COLUMN "last_retry_error" TEXT;
CREATE INDEX "flow_runs_retry_scheduled_for_idx" ON "flow_runs"("retry_scheduled_for");

-- Explicit Slack notification steps inside flow graphs.
ALTER TYPE "FlowNodeType" ADD VALUE IF NOT EXISTS 'slack';
