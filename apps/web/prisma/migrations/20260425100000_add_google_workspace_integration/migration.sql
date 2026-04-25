-- CreateTable
CREATE TABLE "google_workspace_integration" (
    "singleton_key" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_workspace_integration_pkey" PRIMARY KEY ("singleton_key")
);
