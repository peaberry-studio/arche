CREATE TABLE "organization_provider_credentials" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "ProviderCredentialStatus" NOT NULL DEFAULT 'enabled',
    "version" INTEGER NOT NULL,
    "secret" TEXT NOT NULL,
    "last_error" TEXT,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_provider_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_usage_daily" (
    "id" TEXT NOT NULL,
    "bucket_date" DATE NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "credential_source" TEXT NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_usage_daily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_usage_runs" (
    "id" TEXT NOT NULL,
    "message_run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "credential_source" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_usage_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_provider_credentials_provider_id_idx" ON "organization_provider_credentials"("provider_id");

CREATE UNIQUE INDEX "provider_usage_daily_bucket_user_provider_model_source_key" ON "provider_usage_daily"("bucket_date", "user_id", "provider_id", "model_id", "source", "credential_source");
CREATE INDEX "provider_usage_daily_bucket_date_idx" ON "provider_usage_daily"("bucket_date");
CREATE INDEX "provider_usage_daily_user_id_idx" ON "provider_usage_daily"("user_id");
CREATE INDEX "provider_usage_daily_provider_id_model_id_idx" ON "provider_usage_daily"("provider_id", "model_id");

CREATE UNIQUE INDEX "provider_usage_runs_message_run_id_key" ON "provider_usage_runs"("message_run_id");
CREATE INDEX "provider_usage_runs_user_id_idx" ON "provider_usage_runs"("user_id");
CREATE INDEX "provider_usage_runs_provider_id_model_id_idx" ON "provider_usage_runs"("provider_id", "model_id");
CREATE INDEX "provider_usage_runs_created_at_idx" ON "provider_usage_runs"("created_at");

ALTER TABLE "provider_usage_daily" ADD CONSTRAINT "provider_usage_daily_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_usage_runs" ADD CONSTRAINT "provider_usage_runs_message_run_id_fkey" FOREIGN KEY ("message_run_id") REFERENCES "message_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_usage_runs" ADD CONSTRAINT "provider_usage_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
