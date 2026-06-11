-- CreateEnum
CREATE TYPE "KnowledgeLearningRunStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "KnowledgeLearningTrigger" AS ENUM ('manual', 'auto', 'flow', 'agent');

-- CreateEnum
CREATE TYPE "KnowledgeLearningProposalStatus" AS ENUM ('pending', 'rejected', 'applied');

-- CreateEnum
CREATE TYPE "KnowledgeLearningProposalType" AS ENUM ('fact', 'preference', 'process', 'correction', 'other');

-- CreateEnum
CREATE TYPE "KnowledgeLearningOperation" AS ENUM ('create', 'update');

-- CreateTable
CREATE TABLE "knowledge_learning_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_session_id" TEXT,
    "internal_session_id" TEXT,
    "title" TEXT NOT NULL,
    "trigger" "KnowledgeLearningTrigger" NOT NULL,
    "status" "KnowledgeLearningRunStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_learning_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_learning_proposals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "run_id" TEXT,
    "status" "KnowledgeLearningProposalStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "type" "KnowledgeLearningProposalType" NOT NULL DEFAULT 'other',
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "kb_path" TEXT NOT NULL,
    "operation" "KnowledgeLearningOperation" NOT NULL,
    "proposed_content" TEXT NOT NULL,
    "current_file_hash" TEXT,
    "internal_session_id" TEXT,
    "trigger" "KnowledgeLearningTrigger" NOT NULL,
    "applied_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_learning_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_learning_runs_user_id_created_at_idx" ON "knowledge_learning_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_learning_runs_user_id_source_session_id_idx" ON "knowledge_learning_runs"("user_id", "source_session_id");

-- CreateIndex
CREATE INDEX "knowledge_learning_runs_status_idx" ON "knowledge_learning_runs"("status");

-- CreateIndex
CREATE INDEX "knowledge_learning_proposals_user_id_status_created_at_idx" ON "knowledge_learning_proposals"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_learning_proposals_run_id_idx" ON "knowledge_learning_proposals"("run_id");

-- CreateIndex
CREATE INDEX "knowledge_learning_proposals_kb_path_idx" ON "knowledge_learning_proposals"("kb_path");

-- AddForeignKey
ALTER TABLE "knowledge_learning_runs" ADD CONSTRAINT "knowledge_learning_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_learning_proposals" ADD CONSTRAINT "knowledge_learning_proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_learning_proposals" ADD CONSTRAINT "knowledge_learning_proposals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "knowledge_learning_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
