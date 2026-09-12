import { prisma } from "../config/prisma";
import { ApiError } from "../utils/errors";
import { logAudit } from "../utils/auditLog";
import { publishIncidentChanged } from "./realtime.service";
import { webhookService } from "./webhook.service";
import type {
  IncidentQueryInput,
  CreateIncidentInput,
  UpdateIncidentStatusInput,
  AssignIncidentInput,
  AddIncidentNoteInput,
} from "../types";
import type { IncidentStatus, AlertSeverity, AuditLogAction, Prisma } from "@prisma/client";

interface ActorContext {
  userId?: string;
  username?: string;
  email?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface AuthorRecord {
  id: string;
  name: string;
  email?: string;
}

const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  new: ["acknowledged"],
  acknowledged: ["investigating", "reopened"],
  investigating: ["acknowledged", "resolved"],
  resolved: ["reopened"],
  reopened: ["investigating", "resolved"],
};

export const incidentStatusLabels: Record<IncidentStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  investigating: "Investigating",
  resolved: "Resolved",
  reopened: "Reopened",
};

const STATUS_AUDIT_ACTION: Record<IncidentStatus, AuditLogAction> = {
  new: "incident_status_changed",
  acknowledged: "incident_status_changed",
  investigating: "incident_status_changed",
  resolved: "incident_resolved",
  reopened: "incident_reopened",
};

const incidentInclude = {
  alert: {
    include: {
      detection: {
        include: {
          camera: true,
        },
      },
    },
  },
  notes: {
    orderBy: { createdAt: "asc" as const },
  },
  activity: {
    orderBy: { createdAt: "asc" as const },
  },
  assignedTo: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} satisfies Prisma.IncidentInclude;

function buildWhere(params: Pick<IncidentQueryInput, "status" | "priority" | "assignedTo" | "search">): Prisma.IncidentWhereInput {
  const where: Prisma.IncidentWhereInput = {};

  if (params.status) {
    where.status = params.status;
  }

  if (params.priority) {
    where.priority = params.priority;
  }

  if (params.assignedTo) {
    where.assignedToUserId = params.assignedTo;
  }

  if (params.search) {
    where.OR = [
      { title: { contains: params.search, mode: "insensitive" } },
      { description: { contains: params.search, mode: "insensitive" } },
      { alert: { title: { contains: params.search, mode: "insensitive" } } },
      { alert: { message: { contains: params.search, mode: "insensitive" } } },
    ];
  }

  return where;
}

function orderBy(sortBy?: string, sortOrder?: string): Prisma.IncidentOrderByWithRelationInput[] {
  const direction = sortOrder === "asc" ? "asc" : "desc";
  switch (sortBy) {
    case "status":
    case "priority":
    case "title":
      return [{ [sortBy]: direction } as Prisma.IncidentOrderByWithRelationInput, { openedAt: "desc" }];
    case "createdAt":
    case "updatedAt":
    default:
      return [{ openedAt: "desc" }, { id: "desc" }];
  }
}

async function authorFrom(ctx: ActorContext): Promise<AuthorRecord> {
  if (ctx.userId) {
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { id: true, name: true, email: true },
    });
    if (user) return user;
  }
  return { id: ctx.userId || "system", name: ctx.username || "System", email: ctx.email };
}

async function audit(params: {
  action: AuditLogAction;
  module: string;
  description: string;
  incidentId: string;
  alertId: string;
  ctx: ActorContext;
  metadata?: Record<string, unknown>;
}) {
  const author = params.ctx.userId
    ? await prisma.user.findUnique({
        where: { id: params.ctx.userId },
        select: { id: true, name: true, email: true },
      })
    : null;

  await logAudit({
    userId: params.ctx.userId || undefined,
    username: author?.name || params.ctx.username || "",
    email: author?.email || params.ctx.email || "",
    action: params.action,
    module: params.module,
    description: params.description,
    ipAddress: params.ctx.ipAddress,
    userAgent: params.ctx.userAgent,
    metadata: {
      ...(params.metadata || {}),
      incidentId: params.incidentId,
      alertId: params.alertId,
    },
  });
}

async function logActivity(
  incidentId: string,
  action: string,
  author: AuthorRecord,
  fromValue?: string | null,
  toValue?: string | null,
) {
  await prisma.incidentActivity.create({
    data: {
      incidentId,
      action,
      authorId: author.id,
      authorName: author.name,
      fromValue: fromValue ?? null,
      toValue: toValue ?? null,
    },
  });
}

export const incidentService = {
  async create(input: CreateIncidentInput, ctx: ActorContext = {}) {
    const alert = await prisma.alert.findUnique({
      where: { id: input.alertId },
      include: {
        detection: {
          include: {
            camera: true,
          },
        },
        incident: true,
      },
    });

    if (!alert) {
      throw new ApiError(404, "Alert not found");
    }

    if (alert.incident) {
      throw new ApiError(409, "An incident already exists for this alert");
    }

    const author = await authorFrom(ctx);
    const title = alert.title;
    const priority = input.priority ?? alert.severity;

    const incident = await prisma.incident.create({
      data: {
        alertId: alert.id,
        priority,
        title,
        description: input.description,
      },
      include: incidentInclude,
    });

    if (input.description) {
      await logActivity(incident.id, "description_set", author, undefined, input.description);
    }

    await logActivity(incident.id, "opened", author, undefined, incident.status);

    await audit({
      action: "incident_created",
      module: "incidents",
      description: `Incident opened from alert: ${title}`,
      incidentId: incident.id,
      alertId: alert.id,
      ctx,
      metadata: { alertSeverity: alert.severity, priority },
    });

    publishIncidentChanged({ id: incident.id, status: incident.status, action: "created" });
    void webhookService.dispatchIncidentChanged({
      id: incident.id,
      status: incident.status,
      action: "created",
    });

    return prisma.incident.findUnique({
      where: { id: incident.id },
      include: incidentInclude,
    });
  },

  async findAll(params: IncidentQueryInput) {
    const where = buildWhere(params);

    const [data, total] = await Promise.all([
      prisma.incident.findMany({
        where,
        include: incidentInclude,
        orderBy: orderBy(params.sortBy, params.sortOrder),
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.incident.count({ where }),
    ]);

    return { data, total };
  },

  async findById(id: string) {
    const incident = await prisma.incident.findUnique({
      where: { id },
      include: incidentInclude,
    });
    if (!incident) {
      throw new ApiError(404, "Incident not found");
    }
    return incident;
  },

  async changeStatus(id: string, input: UpdateIncidentStatusInput, ctx: ActorContext = {}) {
    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new ApiError(404, "Incident not found");
    }

    if (incident.status === input.status) {
      return prisma.incident.findUnique({ where: { id }, include: incidentInclude });
    }

    const allowed = ALLOWED_TRANSITIONS[incident.status];
    if (!allowed.includes(input.status)) {
      throw new ApiError(
        422,
        `Cannot transition incident from "${incident.status}" to "${input.status}"`,
      );
    }

    const author = await authorFrom(ctx);
    const data: Prisma.IncidentUpdateInput = {
      status: input.status,
    };

    if (input.status === "acknowledged") {
      data.acknowledgedAt = incident.acknowledgedAt ?? new Date();
    }
    if (input.status === "investigating") {
      data.investigatingAt = incident.investigatingAt ?? new Date();
    }
    if (input.status === "resolved") {
      data.resolvedAt = new Date();
      data.resolvedById = author.id;
      data.resolvedByName = author.name;
    }

    const updated = await prisma.incident.update({
      where: { id },
      data,
      include: incidentInclude,
    });

    await logActivity(incident.id, "status_changed", author, incident.status, input.status);

    await audit({
      action: STATUS_AUDIT_ACTION[input.status],
      module: "incidents",
      description: `Incident status changed from "${incident.status}" to "${input.status}"`,
      incidentId: incident.id,
      alertId: incident.alertId,
      ctx,
      metadata: { previousStatus: incident.status, nextStatus: input.status },
    });

    publishIncidentChanged({ id: incident.id, status: input.status, action: "status_changed" });
    void webhookService.dispatchIncidentChanged({
      id: incident.id,
      status: input.status,
      action: "status_changed",
    });

    return updated;
  },

  async changePriority(id: string, priority: AlertSeverity, ctx: ActorContext = {}) {
    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new ApiError(404, "Incident not found");
    }

    if (incident.priority === priority) {
      return prisma.incident.findUnique({ where: { id }, include: incidentInclude });
    }

    const author = await authorFrom(ctx);

    const updated = await prisma.incident.update({
      where: { id },
      data: { priority },
      include: incidentInclude,
    });

    await logActivity(incident.id, "priority_changed", author, incident.priority, priority);

    await audit({
      action: "incident_status_changed",
      module: "incidents",
      description: `Incident priority changed from "${incident.priority}" to "${priority}"`,
      incidentId: incident.id,
      alertId: incident.alertId,
      ctx,
      metadata: { previousPriority: incident.priority, nextPriority: priority },
    });

    return updated;
  },

  async assign(id: string, input: AssignIncidentInput, ctx: ActorContext = {}) {
    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new ApiError(404, "Incident not found");
    }

    if (incident.status === "resolved") {
      throw new ApiError(422, "Cannot assign a resolved incident");
    }

    let assignedToName: string | undefined;
    if (input.assigneeId) {
      const assignee = await prisma.user.findUnique({
        where: { id: input.assigneeId },
        select: { id: true, name: true, status: true, deletedAt: true },
      });
      if (!assignee || assignee.deletedAt) {
        throw new ApiError(404, "Assignee user not found");
      }
      if (assignee.status === "disabled") {
        throw new ApiError(422, "Cannot assign to a disabled user");
      }
      assignedToName = assignee.name;
    }

    if ((incident.assignedToUserId ?? null) === (input.assigneeId ?? null)) {
      return prisma.incident.findUnique({ where: { id }, include: incidentInclude });
    }

    const author = await authorFrom(ctx);

    const updated = await prisma.incident.update({
      where: { id },
      data: {
        assignedToUserId: input.assigneeId,
        assignedToName: assignedToName ?? null,
      },
      include: incidentInclude,
    });

    const isAssign = Boolean(input.assigneeId);
    await logActivity(
      incident.id,
      isAssign ? "assigned" : "unassigned",
      author,
      incident.assignedToUserId ?? null,
      input.assigneeId,
    );

    await audit({
      action: isAssign ? "incident_assigned" : "incident_unassigned",
      module: "incidents",
      description: isAssign
        ? `Incident assigned to ${assignedToName || input.assigneeId}`
        : "Incident unassigned",
      incidentId: incident.id,
      alertId: incident.alertId,
      ctx,
      metadata: {
        previousAssigneeId: incident.assignedToUserId,
        nextAssigneeId: input.assigneeId,
        nextAssigneeName: assignedToName,
      },
    });

    return updated;
  },

  async addNote(id: string, input: AddIncidentNoteInput, ctx: ActorContext = {}) {
    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new ApiError(404, "Incident not found");
    }

    const author = await authorFrom(ctx);

    const note = await prisma.incidentNote.create({
      data: {
        incidentId: id,
        authorId: author.id,
        authorName: author.name,
        body: input.body,
      },
    });

    await logActivity(incident.id, "note_added", author, undefined, note.id);

    await audit({
      action: "incident_note_added",
      module: "incidents",
      description: `Investigation note added to incident`,
      incidentId: incident.id,
      alertId: incident.alertId,
      ctx,
      metadata: { noteId: note.id },
    });

    return prisma.incident.findUnique({ where: { id }, include: incidentInclude });
  },

  async summary() {
    const [grouped, totalOpen, totalResolved] = await Promise.all([
      prisma.incident.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.incident.count({ where: { status: { not: "resolved" } } }),
      prisma.incident.count({ where: { status: "resolved" } }),
    ]);

    const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
    return {
      total: totalOpen + totalResolved,
      open: totalOpen,
      resolved: totalResolved,
      byStatus,
    };
  },
};