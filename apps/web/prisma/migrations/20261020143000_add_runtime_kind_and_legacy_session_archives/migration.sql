-- AlterTable
ALTER TABLE "instances" ADD COLUMN "runtime_kind" TEXT;

-- CreateTable
CREATE TABLE "legacy_session_archives" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "messages" JSONB NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_session_archives_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legacy_session_archives_slug_fkey" FOREIGN KEY ("slug") REFERENCES "users"("slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "legacy_session_archives_slug_session_id_key" ON "legacy_session_archives"("slug", "session_id");
