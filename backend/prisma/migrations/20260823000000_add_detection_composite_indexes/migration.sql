-- Composite indexes for per-camera and per-detector history queries:
-- both filter on the leading column and order by timestamp DESC, so the
-- composite lets PostgreSQL read the range pre-sorted.
CREATE INDEX "detections_camera_id_timestamp_idx" ON "detections"("camera_id", "timestamp" DESC);
CREATE INDEX "detections_detector_key_timestamp_idx" ON "detections"("detector_key", "timestamp" DESC);
