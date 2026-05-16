-- CreateEnum
CREATE TYPE "FlowRunStatus" AS ENUM ('running', 'waiting_for_human', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "FlowRunTrigger" AS ENUM ('on_create', 'schedule', 'manual', 'resume');

-- CreateEnum
CREATE TYPE "FlowRunStepStatus" AS ENUM ('pending', 'running', 'waiting_for_human', 'succeeded', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "FlowNodeType" AS ENUM ('agent', 'human', 'condition', 'merge', 'compaction');

-- CreateTable
CREATE TABLE "flows" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "cron_expression" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_runs" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "status" "FlowRunStatus" NOT NULL,
    "trigger" "FlowRunTrigger" NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error" TEXT,
    "opencode_session_id" TEXT,
    "session_title" TEXT,
    "current_node_id" TEXT,
    "result_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_run_steps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "node_name" TEXT,
    "node_type" "FlowNodeType" NOT NULL,
    "status" "FlowRunStepStatus" NOT NULL,
    "input" JSONB,
    "raw_output" TEXT,
    "compacted_output" TEXT,
    "human_response" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flows_user_id_name_key" ON "flows"("user_id", "name");

-- CreateIndex
CREATE INDEX "flows_user_id_idx" ON "flows"("user_id");

-- CreateIndex
CREATE INDEX "flows_enabled_next_run_at_idx" ON "flows"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "flows_lease_expires_at_idx" ON "flows"("lease_expires_at");

-- CreateIndex
CREATE INDEX "flows_user_id_lease_expires_at_idx" ON "flows"("user_id", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "flow_runs_opencode_session_id_key" ON "flow_runs"("opencode_session_id");

-- CreateIndex
CREATE INDEX "flow_runs_flow_id_started_at_idx" ON "flow_runs"("flow_id", "started_at");

-- CreateIndex
CREATE INDEX "flow_runs_status_idx" ON "flow_runs"("status");

-- CreateIndex
CREATE INDEX "flow_runs_scheduled_for_idx" ON "flow_runs"("scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "flow_run_steps_run_id_node_id_key" ON "flow_run_steps"("run_id", "node_id");

-- CreateIndex
CREATE INDEX "flow_run_steps_run_id_idx" ON "flow_run_steps"("run_id");

-- CreateIndex
CREATE INDEX "flow_run_steps_status_idx" ON "flow_run_steps"("status");

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_run_steps" ADD CONSTRAINT "flow_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "flow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
