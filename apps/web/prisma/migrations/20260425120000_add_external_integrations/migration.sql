-- CreateTable
CREATE TABLE "external_integrations" (
    "key" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_integrations_pkey" PRIMARY KEY ("key")
);
