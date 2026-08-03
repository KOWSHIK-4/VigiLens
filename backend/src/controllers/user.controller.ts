import type { Response, NextFunction } from "express";
import type {
  AuthRequest,
  CreateUserInput,
  UpdateUserInput,
  UserQueryInput,
} from "@/types";
import { userService } from "@/services/user.service";
import { success, paginated } from "@/utils/apiResponse";

export const userController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as unknown as UserQueryInput;
      const result = await userService.findAll({
        page: q.page,
        limit: q.limit,
        search: q.search,
        role: q.role,
        status: q.status,
        sortBy: q.sortBy,
        sortOrder: q.sortOrder,
      });
      paginated(res, result.data, result.total, q.page, q.limit);
    } catch (err) {
      next(err);
    }
  },

  async getStats(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const stats = await userService.stats();
      success(res, stats);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.findById(req.params.id as string);
      success(res, user);
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.create(req.body as CreateUserInput);
      success(res, user, 201);
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.update(
        req.params.id as string,
        req.body as UpdateUserInput,
      );
      success(res, user);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await userService.remove(
        req.params.id as string,
        req.userId,
      );
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async assignRole(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.assignRole(
        req.params.id as string,
        req.body.role as "super_admin" | "admin" | "operator" | "viewer",
        req.userId,
      );
      success(res, user);
    } catch (err) {
      next(err);
    }
  },

  async setStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.setStatus(
        req.params.id as string,
        req.body.status as "active" | "disabled",
        req.userId,
      );
      success(res, user);
    } catch (err) {
      next(err);
    }
  },
};
