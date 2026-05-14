ALTER TABLE "autopilot_tasks" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "autopilot_tasks_user_id_name_active_key"
  ON "autopilot_tasks"("user_id", "name")
  WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "autopilot_tasks_user_id_name_key";
