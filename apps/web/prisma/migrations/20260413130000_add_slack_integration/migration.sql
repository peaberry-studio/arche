-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('HUMAN', 'SERVICE');

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "kind" "UserKind" NOT NULL DEFAULT 'HUMAN';

-- CreateTable
CREATE TABLE "slack_integration" (
    "singleton_key" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "bot_token_secret" TEXT,
    "app_token_secret" TEXT,
    "slack_team_id" TEXT,
    "slack_app_id" TEXT,
    "slack_bot_user_id" TEXT,
    "default_agent_id" TEXT,
    "last_error" TEXT,
    "last_socket_connected_at" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_integration_pkey" PRIMARY KEY ("singleton_key")
);

-- CreateTable
CREATE TABLE "slack_thread_bindings" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "thread_ts" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "execution_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_thread_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_event_receipts" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_event_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slack_thread_bindings_channel_id_thread_ts_key" ON "slack_thread_bindings"("channel_id", "thread_ts");

-- CreateIndex
CREATE INDEX "slack_thread_bindings_execution_user_id_idx" ON "slack_thread_bindings"("execution_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_event_receipts_event_id_key" ON "slack_event_receipts"("event_id");

-- CreateIndex
CREATE INDEX "slack_event_receipts_received_at_idx" ON "slack_event_receipts"("received_at");

-- AddForeignKey
ALTER TABLE "slack_thread_bindings" ADD CONSTRAINT "slack_thread_bindings_execution_user_id_fkey" FOREIGN KEY ("execution_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
