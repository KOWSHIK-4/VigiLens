import type { Request, Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import { prisma } from "@/config/prisma";
import { detectionService } from "@/services/detection.service";
import { metricsService } from "@/services/metrics.service";
import { success, paginated } from "@/utils/apiResponse";
import { ApiError } from "@/utils/errors";
import { logAudit } from "@/utils/auditLog";

export const detectionController = {
  async create(req: Request, res: Response, next: NextFunction) {
    const startedAt = process.hrtime.bigint();
    try {
      const {
        camera_id,
        label,
        confidence,
        image_url,
        metadata,
        bounding_box,
        detector_key,
        track_id,
        class_name,
        model_version,
        processing_time_ms,
        skip_alert,
      } = req.body;

      if (typeof camera_id !== "string" || !camera_id.trim()) {
        throw new ApiError(400, "Camera id is required", { code: "INVALID_CAMERA_ID" });
      }
      const camera = await prisma.camera.findUnique({
        where: { id: camera_id },
        select: { id: true },
      });
      if (!camera) {
        throw new ApiError(400, `Unknown camera "${camera_id}"`, {
          code: "INVALID_CAMERA_ID",
        });
      }
      if (typeof label !== "string" || !label.trim()) {
        throw new ApiError(400, "Detection label is required", { code: "INVALID_LABEL" });
      }
      if (
        typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        throw new ApiError(400, "Confidence must be a number between 0 and 1", {
          code: "INVALID_CONFIDENCE",
        });
      }

      const detection = await detectionService.create({
        cameraId: camera_id,
        label,
        confidence,
        imageUrl: image_url,
        metadata,
        boundingBox: bounding_box,
        detectorKey: detector_key,
        trackId: track_id,
        className: class_name,
        modelVersion: model_version,
        processingTimeMs: processing_time_ms,
        skipAlert: skip_alert === true,
        applyAlertCooldown: res.locals.internal === true,
      });
      const info = {
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      };
      await logAudit({
        action: "detection_created",
        module: "detections",
        description: `Detection created: ${detection.label}`,
        ...info,
        metadata: { detectionId: detection.id, label: detection.label, cameraId: camera_id },
      });
      metricsService.recordDetection(
        Number(process.hrtime.bigint() - startedAt) / 1e6,
      );
      success(res, detection, 201);
    } catch (err) {
      next(err);
    }
  },

  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query;
      const page = typeof q.page === "string" ? q.page : "1";
      const limit = typeof q.limit === "string" ? q.limit : "20";
      const status = typeof q.status === "string" ? q.status : undefined;
      const search = typeof q.search === "string" ? q.search : undefined;
      const cameraId = typeof q.cameraId === "string" ? q.cameraId : undefined;
      const dateFrom = typeof q.dateFrom === "string" ? q.dateFrom : undefined;
      const dateTo = typeof q.dateTo === "string" ? q.dateTo : undefined;
      const confidenceMin = typeof q.confidenceMin === "string" ? q.confidenceMin : undefined;
      const confidenceMax = typeof q.confidenceMax === "string" ? q.confidenceMax : undefined;
      const sortBy = typeof q.sortBy === "string" ? q.sortBy : undefined;
      const sortOrder = typeof q.sortOrder === "string" ? q.sortOrder : undefined;

      const result = await detectionService.findAll({
        page: parseInt(page),
        limit: parseInt(limit),
        search,
        status,
        cameraId,
        dateFrom,
        dateTo,
        confidenceMin,
        confidenceMax,
        sortBy,
        sortOrder,
      });
      paginated(
        res,
        result.data,
        result.total,
        parseInt(page || "1"),
        parseInt(limit || "20"),
      );
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const detection = await detectionService.findById(id);
      success(res, detection);
    } catch (err) {
      next(err);
    }
  },

  async exportCSV(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query;
      const csv = await detectionService.exportCSV({
        search: typeof q.search === "string" ? q.search : undefined,
        status: typeof q.status === "string" ? q.status : undefined,
        cameraId: typeof q.cameraId === "string" ? q.cameraId : undefined,
        dateFrom: typeof q.dateFrom === "string" ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === "string" ? q.dateTo : undefined,
        confidenceMin: typeof q.confidenceMin === "string" ? q.confidenceMin : undefined,
        confidenceMax: typeof q.confidenceMax === "string" ? q.confidenceMax : undefined,
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=detections-${Date.now()}.csv`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },

  async getStats(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const stats = await detectionService.getStats();
      success(res, stats);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const detection = await detectionService.findById(id);
      const result = await detectionService.remove(id);
      const actor = req.userId
        ? await prisma.user.findFirst({
            where: { id: req.userId },
            select: { name: true, email: true },
          })
        : null;
      const info = {
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      };
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "detection_deleted",
        module: "detections",
        description: `Detection deleted: ${detection.label}`,
        ...info,
        metadata: {
          detectionId: id,
          label: detection.label,
          cameraId: detection.cameraId,
        },
      });
      success(res, result);
    } catch (err) {
      next(err);
    }
  },
};
