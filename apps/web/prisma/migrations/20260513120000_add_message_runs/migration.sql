CREATE TABLE "message_runs" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_run_locks" (
    "slug" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_run_locks_pkey" PRIMARY KEY ("slug", "opencode_session_id")
);

CREATE INDEX "message_runs_slug_opencode_session_id_status_idx" ON "message_runs"("slug", "opencode_session_id", "status");
CREATE INDEX "message_runs_started_at_idx" ON "message_runs"("started_at");
CREATE UNIQUE INDEX "message_run_locks_run_id_key" ON "message_run_locks"("run_id");
CREATE INDEX "message_run_locks_run_id_idx" ON "message_run_locks"("run_id");

ALTER TABLE "message_run_locks" ADD CONSTRAINT "message_run_locks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "message_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
