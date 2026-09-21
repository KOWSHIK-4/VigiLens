import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { globalSearchService } from "../services/globalSearch.service";
import { success, error } from "../utils/apiResponse";

export const searchController = {
  async globalSearch(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = String(req.query.q ?? "").trim();
      if (!q || q.length < 2) {
        return error(res, "Search term must be at least 2 characters", 400);
      }

      const result = await globalSearchService.search({
        term: q,
        type: req.query.type as string | undefined,
        limit: Number(req.query.limit) || 10,
        permissions: req.permissions,
        organizationId: req.organizationId,
      });

      return success(res, {
        query: result.query,
        sections: result.sections,
        totalMatches: result.totalMatches,
        searchedTypes: result.searchedTypes,
      });
    } catch (err) {
      next(err);
    }
  },
};