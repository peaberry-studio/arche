-- CreateEnum
CREATE TYPE "KnowledgeReviewChangeStatus" AS ENUM ('open', 'needs_rebase', 'applied', 'published', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "KnowledgeReviewOperation" AS ENUM ('create', 'update', 'delete');

-- AddColumn
ALTER TABLE "knowledge_learning_runs" ADD COLUMN "regeneration_change_id" TEXT;

-- CreateIndex
CREATE INDEX "knowledge_learning_runs_regeneration_change_id_idx" ON "knowledge_learning_runs"("regeneration_change_id");

-- CreateTable
CREATE TABLE "knowledge_review_changes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_proposal_id" TEXT,
    "regenerated_from_id" TEXT,
    "run_id" TEXT,
    "author" TEXT NOT NULL,
    "agent" TEXT,
    "origin" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "kb_path" TEXT NOT NULL,
    "operation" "KnowledgeReviewOperation" NOT NULL,
    "base_content" TEXT,
    "base_hash" TEXT,
    "proposed_content" TEXT NOT NULL,
    "status" "KnowledgeReviewChangeStatus" NOT NULL DEFAULT 'open',
    "actual_content" TEXT,
    "actual_hash" TEXT,
    "applied_hash" TEXT,
    "publish_commit_sha" TEXT,
    "audit_trail" JSONB NOT NULL DEFAULT '[]',
    "applied_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_review_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_review_changes_source_proposal_id_key" ON "knowledge_review_changes"("source_proposal_id");

-- CreateIndex
CREATE INDEX "knowledge_review_changes_user_id_status_created_at_idx" ON "knowledge_review_changes"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_review_changes_user_id_kb_path_status_idx" ON "knowledge_review_changes"("user_id", "kb_path", "status");

-- CreateIndex
CREATE INDEX "knowledge_review_changes_run_id_idx" ON "knowledge_review_changes"("run_id");

-- CreateIndex
CREATE INDEX "knowledge_review_changes_regenerated_from_id_idx" ON "knowledge_review_changes"("regenerated_from_id");

-- AddForeignKey
ALTER TABLE "knowledge_review_changes" ADD CONSTRAINT "knowledge_review_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_changes" ADD CONSTRAINT "knowledge_review_changes_regenerated_from_id_fkey" FOREIGN KEY ("regenerated_from_id") REFERENCES "knowledge_review_changes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate historical pending proposals conservatively. The old model never stored
-- canonical base content, so these records must be rebased before application.
INSERT INTO "knowledge_review_changes" (
    "id", "user_id", "source_proposal_id", "run_id", "author", "agent", "origin",
    "title", "reason", "evidence", "confidence", "kb_path", "operation",
    "base_hash", "proposed_content", "status", "audit_trail", "created_at", "updated_at"
)
SELECT
    'legacy-' || "id", "user_id", "id", "run_id", 'knowledge-curator', 'knowledge-curator', 'learning',
    "title", 'Migrated from a legacy learning proposal.', "evidence", "confidence", "kb_path",
    "operation"::text::"KnowledgeReviewOperation", "current_file_hash", "proposed_content", 'needs_rebase',
    jsonb_build_array(jsonb_build_object('action', 'migrated', 'actor', 'system', 'at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
    "created_at", "updated_at"
FROM "knowledge_learning_proposals"
WHERE "status" = 'pending';
