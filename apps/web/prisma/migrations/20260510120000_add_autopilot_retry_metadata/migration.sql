-- Additive retry metadata for autopilot reliability.
ALTER TABLE "autopilot_tasks" ADD COLUMN "retry_attempt" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "autopilot_tasks" ADD COLUMN "retry_scheduled_for" TIMESTAMP(3);

ALTER TABLE "autopilot_runs" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "autopilot_tasks_user_id_lease_expires_at_idx" ON "autopilot_tasks"("user_id", "lease_expires_at");
CREATE INDEX "autopilot_tasks_retry_scheduled_for_idx" ON "autopilot_tasks"("retry_scheduled_for");
