-- AlterTable
ALTER TABLE "detections" ADD COLUMN     "bounding_box" JSONB,
ADD COLUMN     "class_name" TEXT,
ADD COLUMN     "detector_id" TEXT,
ADD COLUMN     "detector_key" TEXT,
ADD COLUMN     "model_version" TEXT,
ADD COLUMN     "processing_time_ms" INTEGER,
ADD COLUMN     "snapshot_url" TEXT,
ADD COLUMN     "track_id" TEXT;

-- CreateIndex
CREATE INDEX "detections_detector_key_idx" ON "detections"("detector_key");

-- CreateIndex
CREATE INDEX "detections_track_id_idx" ON "detections"("track_id");
