import type { Response, NextFunction } from "express";
import type { AuthRequest, ModelQueryInput } from "@/types";
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

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.findById(req.params.id as string);
      success(res, model);
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const model = await modelService.update(req.params.id as string, req.body);
      success(res, model);
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
