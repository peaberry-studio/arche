CREATE TABLE "mcp_rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "reset_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "mcp_rate_limit_buckets_reset_at_idx" ON "mcp_rate_limit_buckets"("reset_at");
