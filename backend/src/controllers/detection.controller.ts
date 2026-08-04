import type { Request, Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import { detectionService } from "@/services/detection.service";
import { success, paginated } from "@/utils/apiResponse";
import { logAudit } from "@/utils/auditLog";

export const detectionController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { camera_id, label, confidence, image_url, metadata } = req.body;
      const detection = await detectionService.create({
        cameraId: camera_id,
        label,
        confidence,
        imageUrl: image_url,
        metadata,
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
};
