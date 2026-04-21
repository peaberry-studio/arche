-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "provider_sync_hash" TEXT,
ADD COLUMN     "provider_synced_at" TIMESTAMP(3);
