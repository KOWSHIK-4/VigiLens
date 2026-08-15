import type { Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import type { CameraStatus, CameraType } from "@prisma/client";
import { cameraService } from "@/services/camera.service";
import { userService } from "@/services/user.service";
import { success, paginated, error } from "@/utils/apiResponse";
import { logAudit } from "@/utils/auditLog";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

export const cameraController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await cameraService.findAll({
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
        search: req.query.search as string | undefined,
        status: req.query.status as CameraStatus | undefined,
        cameraType: req.query.cameraType as CameraType | undefined,
        sortBy: req.query.sortBy as string | undefined,
        sortOrder: req.query.sortOrder as "asc" | "desc" | undefined,
      });

      paginated(res, result.data, result.total, result.page, result.limit);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const camera = await cameraService.findById(id);

      if (!camera) {
        return error(res, "Camera not found", 404);
      }

      success(res, camera);
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const camera = await cameraService.create(req.body);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "camera_added",
        module: "cameras",
        description: `Camera added: ${camera.name}`,
        ...info,
        metadata: { cameraId: camera.id, name: camera.name, type: camera.cameraType },
      });
      success(res, camera, 201);
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const camera = await cameraService.update(id, req.body);

      if (!camera) {
        return error(res, "Camera not found", 404);
      }

      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "camera_updated",
        module: "cameras",
        description: `Camera updated: ${camera.name}`,
        ...info,
        metadata: { cameraId: camera.id, name: camera.name, fields: Object.keys(req.body) },
      });
      success(res, camera);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const existingCamera = await cameraService.findById(id);
      const deleted = await cameraService.remove(id);

      if (!deleted) {
        return error(res, "Camera not found", 404);
      }

      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "camera_deleted",
        module: "cameras",
        description: `Camera deleted: ${existingCamera?.name || id}`,
        ...info,
        metadata: { cameraId: id, name: existingCamera?.name },
      });
      success(res, { message: "Camera deleted successfully" });
    } catch (err) {
      next(err);
    }
  },

  async start(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const camera = await cameraService.startCamera(id);

      if (!camera) {
        return error(res, "Camera not found", 404);
      }

      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "camera_started",
        module: "cameras",
        description: `Camera started: ${camera.name}`,
        ...info,
        metadata: { cameraId: camera.id, name: camera.name },
      });
      success(res, camera);
    } catch (err) {
      next(err);
    }
  },

  async stop(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const camera = await cameraService.stopCamera(id);

      if (!camera) {
        return error(res, "Camera not found", 404);
      }

      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "camera_stopped",
        module: "cameras",
        description: `Camera stopped: ${camera.name}`,
        ...info,
        metadata: { cameraId: camera.id, name: camera.name },
      });
      success(res, camera);
    } catch (err) {
      next(err);
    }
  },

  async healthCheck(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const camera = await cameraService.healthCheck(id);

      if (!camera) {
        return error(res, "Camera not found", 404);
      }

      success(res, camera);
    } catch (err) {
      next(err);
    }
  },

  async getHealthLogs(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const logs = await cameraService.getHealthLogs(
        id,
        Number(req.query.limit) || 50,
      );
      success(res, logs);
    } catch (err) {
      next(err);
    }
  },

  async capture(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const result = await cameraService.captureSnapshot(id);

      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "camera_captured",
        module: "cameras",
        description: `Frame captured for camera: ${result.camera?.name || id}`,
        ...info,
        metadata: {
          cameraId: id,
          responseTimeMs: result.responseTimeMs,
          snapshotUrl: result.snapshotUrl,
        },
      });

      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async getThumbnail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const buffer = await cameraService.getSnapshot(id);

      if (!buffer) {
        return error(res, "No snapshot available for this camera yet", 404);
      }

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
};
