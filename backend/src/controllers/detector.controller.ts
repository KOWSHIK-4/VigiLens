import type { Response, NextFunction } from "express";
import type {
  AuthRequest,
  DetectorQueryInput,
  InstallDetectorInput,
  UpdateDetectorInput,
  DetectorSettingsInput,
  DetectorCamerasInput,
} from "@/types";
import { detectorService } from "@/services/detector.service";
import { userService } from "@/services/user.service";
import { getMergedDetectorHealth } from "@/engine/health";
import { success, paginated } from "@/utils/apiResponse";
import { logAudit } from "@/utils/auditLog";

type DetectorAuditAction =
  | "detector_created"
  | "detector_updated"
  | "detector_deleted"
  | "detector_enabled"
  | "detector_disabled"
  | "detector_config_updated"
  | "detector_cameras_updated";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

async function audit(
  req: AuthRequest,
  action: DetectorAuditAction,
  description: string,
  metadata: Record<string, unknown>,
) {
  const info = getClientInfo(req);
  const actor = await userService.findById(req.userId!).catch(() => null);
  await logAudit({
    userId: req.userId,
    username: actor?.name || "",
    email: actor?.email || "",
    action,
    module: "detectors",
    description,
    ...info,
    metadata,
  });
}

export const detectorController = {
  async getMarketplace(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await detectorService.getMarketplace();
      success(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getCategories(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      success(res, detectorService.getCategories());
    } catch (err) {
      next(err);
    }
  },

  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as unknown as DetectorQueryInput;
      const result = await detectorService.getAll({
        page: q.page,
        limit: q.limit,
        search: q.search,
        status: q.status,
        type: q.type,
        enabled: q.enabled,
        category: q.category,
        sortBy: q.sortBy,
        sortOrder: q.sortOrder,
      });
      paginated(res, result.data, result.total, q.page, q.limit);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const detector = await detectorService.getById(req.params.id as string);
      success(res, detector);
    } catch (err) {
      next(err);
    }
  },

  async install(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as InstallDetectorInput;
      const detector = await detectorService.install(body.detectorKey);
      await audit(
        req,
        "detector_created",
        `Detector installed: ${detector.name}`,
        { detectorId: detector.id, name: detector.name, detectorKey: detector.detectorKey },
      );
      success(res, detector, 201);
    } catch (err) {
      next(err);
    }
  },

  async uninstall(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await detectorService.uninstall(req.params.id as string);
      await audit(
        req,
        "detector_deleted",
        `Detector uninstalled: ${result.detectorKey}`,
        { detectorId: req.params.id, detectorKey: result.detectorKey },
      );
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as UpdateDetectorInput;
      const detector = await detectorService.update(req.params.id as string, body);
      await audit(
        req,
        "detector_updated",
        `Detector updated: ${detector.name}`,
        { detectorId: detector.id, name: detector.name, fields: Object.keys(body) },
      );
      success(res, detector);
    } catch (err) {
      next(err);
    }
  },

  async enable(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const detector = await detectorService.setEnabled(req.params.id as string, true);
      await audit(
        req,
        "detector_enabled",
        `Detector enabled: ${detector.name}`,
        { detectorId: detector.id, name: detector.name },
      );
      success(res, detector);
    } catch (err) {
      next(err);
    }
  },

  async disable(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const detector = await detectorService.setEnabled(req.params.id as string, false);
      await audit(
        req,
        "detector_disabled",
        `Detector disabled: ${detector.name}`,
        { detectorId: detector.id, name: detector.name },
      );
      success(res, detector);
    } catch (err) {
      next(err);
    }
  },

  async updateSettings(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const detector = await detectorService.updateSettings(
        req.params.id as string,
        req.body as DetectorSettingsInput,
      );
      await audit(
        req,
        "detector_config_updated",
        `Detector configuration updated: ${detector.name}`,
        {
          detectorId: detector.id,
          name: detector.name,
          fields: Object.keys(req.body as object),
        },
      );
      success(res, detector);
    } catch (err) {
      next(err);
    }
  },

  async assignCameras(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as DetectorCamerasInput;
      const detector = await detectorService.assignCameras(req.params.id as string, body);
      const count = body.cameraIds?.length ?? body.assignments?.length ?? 0;
      await audit(
        req,
        "detector_cameras_updated",
        `Detector camera assignments updated: ${detector.name} (${count} cameras)`,
        {
          detectorId: detector.id,
          name: detector.name,
          cameraIds: body.cameraIds ?? body.assignments?.map((a) => a.cameraId),
        },
      );
      success(res, detector);
    } catch (err) {
      next(err);
    }
  },

  async health(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const health = await getMergedDetectorHealth(req.params.id as string);
      success(res, health);
    } catch (err) {
      next(err);
    }
  },

  async restart(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const detector = await detectorService.restart(req.params.id as string);
      await audit(
        req,
        "detector_updated",
        `Detector restart initiated: ${detector.name}`,
        { detectorId: detector.id, name: detector.name },
      );
      success(res, detector);
    } catch (err) {
      next(err);
    }
  },
};
