-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_secret" TEXT,
ADD COLUMN     "totp_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "two_factor_recovery" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "two_factor_recovery_user_id_idx" ON "two_factor_recovery"("user_id");

-- AddForeignKey
ALTER TABLE "two_factor_recovery" ADD CONSTRAINT "two_factor_recovery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
