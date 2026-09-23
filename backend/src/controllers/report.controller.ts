import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { reportService } from "../services/report.service";
import { userService } from "../services/user.service";
import { success, paginated } from "../utils/apiResponse";
import { logAudit } from "../utils/auditLog";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

export const reportController = {
  async generate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { title, type, dateRange } = req.body;
      const report = await reportService.generate({
        title,
        type,
        generatedBy: req.userId!,
        dateRange,
        organizationId: req.organizationId,
      });
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "report_generated",
        module: "reports",
        description: `Report generated: ${title} (${type})`,
        organizationId: req.organizationId,
        ...info,
        metadata: { reportId: report.id, title, type, dateRange },
      });
      success(res, report, 201);
    } catch (err) {
      next(err);
    }
  },

  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // `validate` replaces req.query with zod-coerced data: page/limit are
      // numbers (never strings), otherwise the normalization below silently
      // drops them and the list always returns page 1/limit 20.
      const q = req.query as Record<string, unknown>;
      const page = typeof q.page === "number" ? q.page : 1;
      const limit = typeof q.limit === "number" ? q.limit : 20;
      const search = typeof q.search === "string" ? q.search : undefined;
      const type = typeof q.type === "string" ? q.type : undefined;
      const status = typeof q.status === "string" ? q.status : undefined;
      const sortBy = typeof q.sortBy === "string" ? q.sortBy : undefined;
      const sortOrder = q.sortOrder === "asc" || q.sortOrder === "desc" ? q.sortOrder : undefined;

      const result = await reportService.findAll({
        page,
        limit,
        search,
        type,
        status,
        sortBy,
        sortOrder,
      }, req.organizationId);
      paginated(res, result.data, result.total, page, limit);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const report = await reportService.findById(req.params.id as string, req.organizationId);
      success(res, report);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await reportService.remove(req.params.id as string, req.organizationId);
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async download(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { format } = req.query as unknown as { format: "pdf" | "csv" };
      const { content, filename, mimeType } = await reportService.getDownloadData(
        req.params.id as string,
        format,
        req.organizationId,
      );
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(content);
    } catch (err) {
      next(err);
    }
  },
};
