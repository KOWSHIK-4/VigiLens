import type { Response, NextFunction } from "express";
import type {
  AuthRequest,
  ModelQueryInput,
  CreateModelInput,
  UpdateModelInput,
} from "../types";
import { modelService } from "../services/model.service";
import { userService } from "../services/user.service";
import { success, paginated } from "../utils/apiResponse";
import { logAudit } from "../utils/auditLog";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

export const modelController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as unknown as ModelQueryInput;
      const result = await modelService.findAll({
        page: q.page,
        limit: q.limit,
        search: q.search,
        status: q.status,
        enabled: q.enabled,
        sortBy: q.sortBy,
        sortOrder: q.sortOrder,
      });
      paginated(res, result.data, result.total, q.page, q.limit);
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.create(req.body as CreateModelInput);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "ai_model_updated",
        module: "models",
        description: `AI model created: ${model.name}`,
        ...info,
        metadata: { modelId: model.id, name: model.name, detectorKey: model.detectorKey },
      });
      success(res, model, 201);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.findById(req.params.id as string);
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async getActive(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.getActive();
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.update(
        req.params.id as string,
        req.body as UpdateModelInput,
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "ai_model_updated",
        module: "models",
        description: `AI model updated: ${model.name}`,
        ...info,
        metadata: { modelId: model.id, name: model.name, fields: Object.keys(req.body) },
      });
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async enable(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.setEnabled(req.params.id as string, true);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "ai_model_enabled",
        module: "models",
        description: `AI model enabled: ${model.name}`,
        ...info,
        metadata: { modelId: model.id, name: model.name },
      });
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async disable(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.setEnabled(req.params.id as string, false);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "ai_model_disabled",
        module: "models",
        description: `AI model disabled: ${model.name}`,
        ...info,
        metadata: { modelId: model.id, name: model.name },
      });
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async updateThreshold(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.setConfidenceThreshold(
        req.params.id as string,
        req.body.confidenceThreshold as number,
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "ai_model_updated",
        module: "models",
        description: `Confidence threshold updated for ${model.name}: ${req.body.confidenceThreshold}%`,
        ...info,
        metadata: { modelId: model.id, name: model.name, threshold: req.body.confidenceThreshold },
      });
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const existingModel = await modelService.findById(req.params.id as string).catch(() => null);
      const result = await modelService.remove(req.params.id as string);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "ai_model_updated",
        module: "models",
        description: `AI model deleted: ${existingModel?.name || req.params.id}`,
        ...info,
        metadata: { modelId: req.params.id, name: existingModel?.name },
      });
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async load(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.load(req.params.id as string);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "ai_model_enabled",
        module: "models",
        description: `AI model loading: ${model.name}`,
        ...info,
        metadata: { modelId: model.id, name: model.name },
      });
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async unload(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.unload(req.params.id as string);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "ai_model_disabled",
        module: "models",
        description: `AI model unloaded: ${model.name}`,
        ...info,
        metadata: { modelId: model.id, name: model.name },
      });
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async test(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await modelService.test(req.params.id as string);
      success(res, result);
    } catch (err) {
      next(err);
    }
  },
};
