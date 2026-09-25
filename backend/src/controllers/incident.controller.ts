import type { Response, NextFunction } from "express";
import type {
  AuthRequest,
  IncidentQueryInput,
  CreateIncidentInput,
  UpdateIncidentStatusInput,
  UpdateIncidentPriorityInput,
  AssignIncidentInput,
  AssignIncidentTeamInput,
  AddIncidentNoteInput,
} from "../types";
import { incidentService } from "../services/incident.service";
import { success, paginated } from "../utils/apiResponse";
import { sendCsvStream } from "../utils/csvStream";

function actorFrom(req: AuthRequest) {
  return {
    userId: req.userId,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

export const incidentController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as unknown as IncidentQueryInput;
      const result = await incidentService.findAll(q, req.userId, req.organizationId);
      paginated(res, result.data, result.total, q.page, q.limit);
    } catch (err) {
      next(err);
    }
  },

  async exportCsv(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as unknown as IncidentQueryInput;
      res.setHeader("Content-Disposition", `attachment; filename=incidents-${Date.now()}.csv`);
      await sendCsvStream(
        res,
        [
          "ID", "Status", "Priority", "Title", "Source Camera", "Assignee",
          "Opened At", "Resolved At", "Description",
        ],
        incidentService.streamCSV(q, req.userId, req.organizationId),
      );
    } catch (err) {
      if (!res.headersSent) next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const incident = await incidentService.findById(req.params.id as string, req.organizationId, req.teamScopeId);
      success(res, incident);
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const incident = await incidentService.create(
        req.body as CreateIncidentInput,
        actorFrom(req),
        req.organizationId,
      );
      success(res, incident, 201);
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const incident = await incidentService.changeStatus(
        req.params.id as string,
        req.body as UpdateIncidentStatusInput,
        actorFrom(req),
        req.organizationId,
        req.teamScopeId,
      );
      success(res, incident);
    } catch (err) {
      next(err);
    }
  },

  async updatePriority(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const incident = await incidentService.changePriority(
        req.params.id as string,
        (req.body as UpdateIncidentPriorityInput).priority,
        actorFrom(req),
        req.organizationId,
        req.teamScopeId,
      );
      success(res, incident);
    } catch (err) {
      next(err);
    }
  },

  async assign(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const incident = await incidentService.assign(
        req.params.id as string,
        req.body as AssignIncidentInput,
        actorFrom(req),
        req.organizationId,
        req.teamScopeId,
      );
      success(res, incident);
    } catch (err) {
      next(err);
    }
  },

  async assignTeam(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const incident = await incidentService.assignTeam(
        req.params.id as string,
        (req.body as AssignIncidentTeamInput).teamId,
        actorFrom(req),
        req.organizationId,
        req.teamScopeId,
      );
      success(res, incident);
    } catch (err) {
      next(err);
    }
  },

  async addNote(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const incident = await incidentService.addNote(
        req.params.id as string,
        req.body as AddIncidentNoteInput,
        actorFrom(req),
        req.organizationId,
        req.teamScopeId,
      );
      success(res, incident, 201);
    } catch (err) {
      next(err);
    }
  },

  async getSummary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const summary = await incidentService.summary(req.organizationId, req.teamScopeId);
      success(res, summary);
    } catch (err) {
      next(err);
    }
  },

  async getRelatedDetections(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const related = await incidentService.getRelatedDetections(req.params.id as string, 30, req.organizationId, req.teamScopeId);
      success(res, related);
    } catch (err) {
      next(err);
    }
  },

  async updateResolutionSummary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const incident = await incidentService.updateResolutionSummary(
        req.params.id as string,
        (req.body as { resolutionSummary: string }).resolutionSummary,
        actorFrom(req),
        req.organizationId,
        req.teamScopeId,
      );
      success(res, incident);
    } catch (err) {
      next(err);
    }
  },
};