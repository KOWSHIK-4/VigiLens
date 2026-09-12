import type { Response, NextFunction } from "express";
import type {
  AuthRequest,
  IncidentQueryInput,
  CreateIncidentInput,
  UpdateIncidentStatusInput,
  UpdateIncidentPriorityInput,
  AssignIncidentInput,
  AddIncidentNoteInput,
} from "../types";
import { incidentService } from "../services/incident.service";
import { success, paginated } from "../utils/apiResponse";

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
      const result = await incidentService.findAll(q);
      paginated(res, result.data, result.total, q.page, q.limit);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const incident = await incidentService.findById(req.params.id as string);
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
      );
      success(res, incident, 201);
    } catch (err) {
      next(err);
    }
  },

  async getSummary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const summary = await incidentService.summary();
      success(res, summary);
    } catch (err) {
      next(err);
    }
  },
};