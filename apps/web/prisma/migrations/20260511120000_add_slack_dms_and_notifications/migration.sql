-- Additive Slack DM and Autopilot notification support.

-- CreateEnum
CREATE TYPE "SlackPendingDecisionStatus" AS ENUM ('pending', 'continued', 'started_new', 'expired');

-- AlterTable
ALTER TABLE "autopilot_tasks" ADD COLUMN "slack_notification_config" JSONB;

-- CreateTable
CREATE TABLE "slack_user_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_email" TEXT,
    "display_name" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_user_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_dm_session_bindings" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "execution_user_id" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_dm_session_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_pending_dm_decisions" (
    "id" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "source_ts" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "previous_dm_session_binding_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "SlackPendingDecisionStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_pending_dm_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_notification_channels" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slack_user_links_slack_team_id_slack_user_id_key" ON "slack_user_links"("slack_team_id", "slack_user_id");

-- CreateIndex
CREATE INDEX "slack_user_links_user_id_idx" ON "slack_user_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_dm_session_bindings_opencode_session_id_key" ON "slack_dm_session_bindings"("opencode_session_id");

-- CreateIndex
CREATE INDEX "slack_dm_session_bindings_slack_team_id_slack_user_id_last_message_at_idx" ON "slack_dm_session_bindings"("slack_team_id", "slack_user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "slack_dm_session_bindings_execution_user_id_idx" ON "slack_dm_session_bindings"("execution_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_pending_dm_decisions_source_event_id_key" ON "slack_pending_dm_decisions"("source_event_id");

-- CreateIndex
CREATE INDEX "slack_pending_dm_decisions_expires_at_idx" ON "slack_pending_dm_decisions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "slack_notification_channels_slack_team_id_channel_id_key" ON "slack_notification_channels"("slack_team_id", "channel_id");

-- AddForeignKey
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_dm_session_bindings" ADD CONSTRAINT "slack_dm_session_bindings_execution_user_id_fkey" FOREIGN KEY ("execution_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
