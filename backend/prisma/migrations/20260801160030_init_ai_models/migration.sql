-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'operator', 'viewer');

-- CreateEnum
CREATE TYPE "DetectionStatus" AS ENUM ('critical', 'warning', 'info');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "CameraStatus" AS ENUM ('online', 'offline', 'connecting', 'error');

-- CreateEnum
CREATE TYPE "CameraType" AS ENUM ('usb', 'rtsp', 'ip', 'video_file');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('daily', 'weekly', 'monthly', 'camera', 'detection', 'alert');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('generating', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ModelStatus" AS ENUM ('loaded', 'loading', 'disabled', 'error');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'operator',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cameras" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "camera_type" "CameraType" NOT NULL DEFAULT 'rtsp',
    "source_url" TEXT,
    "location" TEXT,
    "resolution" TEXT,
    "fps" INTEGER,
    "username" TEXT,
    "password" TEXT,
    "thumbnail" TEXT,
    "is_healthy" BOOLEAN NOT NULL DEFAULT true,
    "last_health_check" TIMESTAMP(3),
    "status" "CameraStatus" NOT NULL DEFAULT 'offline',
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cameras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camera_health_logs" (
    "id" TEXT NOT NULL,
    "camera_id" TEXT NOT NULL,
    "status" "CameraStatus" NOT NULL,
    "message" TEXT,
    "response_time" INTEGER,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camera_health_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detections" (
    "id" TEXT NOT NULL,
    "camera_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "DetectionStatus" NOT NULL DEFAULT 'info',
    "image_url" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "detections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "detection_id" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "generated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_range" JSONB NOT NULL,
    "report_url" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'generating',

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detector_key" TEXT NOT NULL,
    "confidence_threshold" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "ModelStatus" NOT NULL DEFAULT 'disabled',
    "gpu_supported" BOOLEAN NOT NULL DEFAULT false,
    "model_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "camera_health_logs_camera_id_idx" ON "camera_health_logs"("camera_id");

-- CreateIndex
CREATE INDEX "camera_health_logs_checked_at_idx" ON "camera_health_logs"("checked_at");

-- CreateIndex
CREATE INDEX "detections_camera_id_idx" ON "detections"("camera_id");

-- CreateIndex
CREATE INDEX "detections_status_idx" ON "detections"("status");

-- CreateIndex
CREATE INDEX "detections_timestamp_idx" ON "detections"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_detection_id_key" ON "alerts"("detection_id");

-- CreateIndex
CREATE INDEX "alerts_severity_idx" ON "alerts"("severity");

-- CreateIndex
CREATE INDEX "alerts_is_read_idx" ON "alerts"("is_read");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- CreateIndex
CREATE INDEX "reports_type_idx" ON "reports"("type");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_created_at_idx" ON "reports"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_detector_key_key" ON "ai_models"("detector_key");

-- CreateIndex
CREATE INDEX "ai_models_status_idx" ON "ai_models"("status");

-- CreateIndex
CREATE INDEX "ai_models_enabled_idx" ON "ai_models"("enabled");

-- AddForeignKey
ALTER TABLE "camera_health_logs" ADD CONSTRAINT "camera_health_logs_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detections" ADD CONSTRAINT "detections_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_detection_id_fkey" FOREIGN KEY ("detection_id") REFERENCES "detections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
