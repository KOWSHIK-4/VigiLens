import type { Response, NextFunction } from "express";
import type {
  AuthRequest,
  ModelQueryInput,
  CreateModelInput,
  UpdateModelInput,
} from "@/types";
import { modelService } from "@/services/model.service";
import { success, paginated } from "@/utils/apiResponse";

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
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async enable(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.setEnabled(req.params.id as string, true);
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async disable(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.setEnabled(req.params.id as string, false);
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
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await modelService.remove(req.params.id as string);
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async load(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.load(req.params.id as string);
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async unload(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.unload(req.params.id as string);
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
