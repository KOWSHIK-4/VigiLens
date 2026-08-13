import type { Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import { prisma } from "@/config/prisma";
import { runtimeRegistry } from "@/engine/runtimeRegistry";
import { engineService } from "@/engine/engineService";
import { detectionService } from "@/services/detection.service";
import { success } from "@/utils/apiResponse";
import { ApiError } from "@/utils/errors";

export const engineController = {
  async listAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const descriptors = await runtimeRegistry.describeAll();
      success(res, descriptors);
    } catch (err) {
      next(err);
    }
  },

  async getByKey(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const descriptor = await runtimeRegistry.describeByKey(req.params.key as string);
      if (!descriptor) {
        throw new ApiError(404, `Unknown detector key "${req.params.key}"`);
      }
      success(res, descriptor);
    } catch (err) {
      next(err);
    }
  },

  async getMetrics(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const descriptor = await runtimeRegistry.describeByKey(req.params.key as string);
      if (!descriptor) {
        throw new ApiError(404, `Unknown detector key "${req.params.key}"`);
      }
      const metrics = await engineService.getMetrics(req.params.key as string);
      success(res, metrics ?? { key: req.params.key, recorded: false, message: "No engine runs recorded yet" });
    } catch (err) {
      next(err);
    }
  },

  async getHealth(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const descriptor = await runtimeRegistry.describeByKey(req.params.key as string);
      if (!descriptor) {
        throw new ApiError(404, `Unknown detector key "${req.params.key}"`);
      }
      const health = await engineService.getHealth(req.params.key as string);
      success(res, health);
    } catch (err) {
      next(err);
    }
  },

  async getDetections(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const key = req.params.key as string;
      const descriptor = await runtimeRegistry.describeByKey(key);
      if (!descriptor) {
        throw new ApiError(404, `Unknown detector key "${key}"`);
      }
      const limit = Math.min(
        Math.max(parseInt((req.query.limit as string) || "25", 10) || 25, 1),
        100,
      );
      const detections = await detectionService.findRecentByDetectorKey(key, limit);
      success(res, {
        key,
        count: detections.length,
        detections: detections.map((d) => ({
          id: d.id,
          className: d.className,
          label: d.label,
          confidence: d.confidence,
          boundingBox: d.boundingBox,
          trackId: d.trackId,
          detectorKey: d.detectorKey,
          modelVersion: d.modelVersion,
          processingTimeMs: d.processingTimeMs,
          snapshotUrl: d.snapshotUrl,
          cameraId: d.cameraId,
          timestamp: d.timestamp.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  },

  async processImage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const key = req.params.key as string;
      if (!req.file) {
        throw new ApiError(400, "No image file uploaded");
      }
      const requestedCameraId =
        (typeof req.body?.camera_id === "string" && req.body.camera_id.trim()) ||
        (typeof req.query?.camera_id === "string" && (req.query.camera_id as string).trim()) ||
        "";

      // Resolve a real camera so persisted detections satisfy the FK.
      let cameraId = requestedCameraId;
      if (cameraId) {
        const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
        if (!camera) throw new ApiError(400, `Unknown camera_id "${cameraId}"`);
      } else {
        const first = await prisma.camera.findFirst({ orderBy: { createdAt: "asc" } });
        if (!first) {
          throw new ApiError(
            400,
            "No camera found: pass a valid camera_id or create a camera before processing frames",
          );
        }
        cameraId = first.id;
      }

      const result = await engineService.processFrame(key, cameraId, req.file.buffer);
      success(res, {
        key,
        cameraId,
        detections: result.detections.map((d) => ({
          id: d.id,
          className: d.className,
          confidence: d.confidence,
          bbox: d.bbox,
          normalized: d.normalized,
          trackId: d.trackId,
          detectorKey: d.detectorKey,
          processingTimeMs: d.processingTimeMs,
          timestamp: d.timestamp.toISOString(),
        })),
        count: result.detections.length,
        metrics: result.metrics,
        processedAt: result.processedAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
};
