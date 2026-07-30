import type { Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import { reportService } from "@/services/report.service";
import { success, paginated } from "@/utils/apiResponse";

export const reportController = {
  async generate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { title, type, dateRange } = req.body;
      const report = await reportService.generate({
        title,
        type,
        generatedBy: req.userId!,
        dateRange,
      });
      success(res, report, 201);
    } catch (err) {
      next(err);
    }
  },

  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query;
      const page = typeof q.page === "string" ? q.page : "1";
      const limit = typeof q.limit === "string" ? q.limit : "20";
      const search = typeof q.search === "string" ? q.search : undefined;
      const type = typeof q.type === "string" ? q.type : undefined;
      const status = typeof q.status === "string" ? q.status : undefined;
      const sortBy = typeof q.sortBy === "string" ? q.sortBy : undefined;
      const sortOrder = q.sortOrder === "asc" || q.sortOrder === "desc" ? q.sortOrder : undefined;

      const result = await reportService.findAll({
        page: parseInt(page),
        limit: parseInt(limit),
        search,
        type,
        status,
        sortBy,
        sortOrder,
      });
      paginated(res, result.data, result.total, parseInt(page), parseInt(limit));
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const report = await reportService.findById(req.params.id as string);
      success(res, report);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await reportService.remove(req.params.id as string);
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async download(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const format = (typeof req.query.format === "string" ? req.query.format : "pdf") as "pdf" | "csv";
      const { content, filename, mimeType } = await reportService.getDownloadData(
        req.params.id as string,
        format,
      );
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      res.send(content);
    } catch (err) {
      next(err);
    }
  },
};
