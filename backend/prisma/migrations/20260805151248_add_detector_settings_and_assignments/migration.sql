-- CreateEnum
CREATE TYPE "ProcessorPreference" AS ENUM ('gpu', 'cpu', 'auto');

-- AlterTable
ALTER TABLE "ai_models" ADD COLUMN     "last_restart_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "detector_settings" (
    "id" TEXT NOT NULL,
    "ai_model_id" TEXT NOT NULL,
    "alert_severity" "AlertSeverity" NOT NULL DEFAULT 'info',
    "detection_interval_ms" INTEGER NOT NULL DEFAULT 5000,
    "preferred_processor" "ProcessorPreference" NOT NULL DEFAULT 'auto',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "detector_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detector_cameras" (
    "id" TEXT NOT NULL,
    "ai_model_id" TEXT NOT NULL,
    "camera_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "detector_cameras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "detector_settings_ai_model_id_key" ON "detector_settings"("ai_model_id");

-- CreateIndex
CREATE INDEX "detector_cameras_camera_id_idx" ON "detector_cameras"("camera_id");

-- CreateIndex
CREATE UNIQUE INDEX "detector_cameras_ai_model_id_camera_id_key" ON "detector_cameras"("ai_model_id", "camera_id");

-- AddForeignKey
ALTER TABLE "detector_settings" ADD CONSTRAINT "detector_settings_ai_model_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detector_cameras" ADD CONSTRAINT "detector_cameras_ai_model_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detector_cameras" ADD CONSTRAINT "detector_cameras_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE CASCADE ON UPDATE CASCADE;
