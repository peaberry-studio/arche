-- CreateEnum
CREATE TYPE "FlowVisibility" AS ENUM ('private', 'team');

-- AlterTable
ALTER TABLE "flows" ADD COLUMN "visibility" "FlowVisibility" NOT NULL DEFAULT 'private';
ALTER TABLE "flows" ADD COLUMN "organization_can_run" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "flow_runs" ADD COLUMN "execution_user_id" TEXT;

-- CreateIndex
CREATE INDEX "flows_visibility_idx" ON "flows"("visibility");

-- CreateIndex
CREATE INDEX "flows_visibility_organization_can_run_idx" ON "flows"("visibility", "organization_can_run");

-- CreateIndex
CREATE INDEX "flow_runs_execution_user_id_idx" ON "flow_runs"("execution_user_id");

-- AddForeignKey
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_execution_user_id_fkey" FOREIGN KEY ("execution_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
