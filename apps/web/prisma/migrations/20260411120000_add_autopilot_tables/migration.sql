-- CreateEnum
CREATE TYPE "AutopilotRunStatus" AS ENUM ('running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "AutopilotRunTrigger" AS ENUM ('on_create', 'schedule', 'manual');

-- CreateTable
CREATE TABLE "autopilot_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cron_expression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "target_agent_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autopilot_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autopilot_runs" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "status" "AutopilotRunStatus" NOT NULL,
    "trigger" "AutopilotRunTrigger" NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error" TEXT,
    "opencode_session_id" TEXT,
    "session_title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autopilot_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autopilot_tasks_user_id_name_key" ON "autopilot_tasks"("user_id", "name");

-- CreateIndex
CREATE INDEX "autopilot_tasks_user_id_idx" ON "autopilot_tasks"("user_id");

-- CreateIndex
CREATE INDEX "autopilot_tasks_enabled_next_run_at_idx" ON "autopilot_tasks"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "autopilot_tasks_lease_expires_at_idx" ON "autopilot_tasks"("lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "autopilot_runs_opencode_session_id_key" ON "autopilot_runs"("opencode_session_id");

-- CreateIndex
CREATE INDEX "autopilot_runs_task_id_started_at_idx" ON "autopilot_runs"("task_id", "started_at");

-- CreateIndex
CREATE INDEX "autopilot_runs_status_idx" ON "autopilot_runs"("status");

-- CreateIndex
CREATE INDEX "autopilot_runs_scheduled_for_idx" ON "autopilot_runs"("scheduled_for");

-- AddForeignKey
ALTER TABLE "autopilot_tasks" ADD CONSTRAINT "autopilot_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "autopilot_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
