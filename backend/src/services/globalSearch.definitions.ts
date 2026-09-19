/**
 * Global search — pure definitions.
 *
 * Maps each searchable entity type to its display metadata, the RBAC
 * permission that gates read access to that type, and a bound query builder
 * for the loader. Keeping this layer pure lets the sectioning, scaling and
 * permission-trimming logic be unit-tested without a database.
 */

export type SearchEntityType = "detections" | "alerts" | "incidents" | "cameras" | "audit" | "users";

export interface SearchSection {
  type: SearchEntityType;
  label: string;
  permission: string;
  count: number;
  results: SearchResult[];
}

export interface SearchResult {
  id: string;
  type: SearchEntityType;
  title: string;
  subtitle: string;
  timestamp: string | null;
  meta: Record<string, string | number | null>;
}

export const SEARCH_TYPE_LABELS: Record<SearchEntityType, string> = {
  detections: "Detections",
  alerts: "Alerts",
  incidents: "Incidents",
  cameras: "Cameras",
  audit: "Audit Log",
  users: "Users",
};

export const SEARCH_TYPE_PERMISSIONS: Record<SearchEntityType, string> = {
  detections: "detections.read",
  alerts: "alerts.read",
  incidents: "alerts.read",
  cameras: "cameras.read",
  audit: "audit.read",
  users: "users.read",
};

export const SEARCH_ENTITY_TYPES: SearchEntityType[] = [
  "detections",
  "alerts",
  "incidents",
  "cameras",
  "audit",
  "users",
];

export interface SearchWhere {
  OR: Array<Record<string, unknown>>;
}

export interface SearchField {
  /** Prisma model field that must exist on the queried model. */
  field: string;
}

export interface EntitySearchSpec {
  displayType: SearchEntityType;
  /** Maps a raw row to the unified result shape. */
  toResult: (row: Record<string, unknown>) => SearchResult;
  /** Where clause schemas per searched field. */
  fields: SearchField[];
}

const ts = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return value;
  return null;
};

const str = (value: unknown): string =>
  typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);

export const SEARCH_ENTITIES: Record<SearchEntityType, EntitySearchSpec> = {
  detections: {
    displayType: "detections",
    fields: [{ field: "label" }, { field: "className" }, { field: "detectorKey" }],
    toResult: (row) => ({
      id: str(row.id),
      type: "detections",
      title: str(row.label),
      subtitle: [
        str(row.className) ? `Class: ${str(row.className)}` : "",
        str(row.cameraName) ? `Camera: ${str(row.cameraName)}` : "",
        str(row.confidence) ? `Confidence: ${Number(row.confidence).toFixed(2)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      timestamp: ts(row.timestamp),
      meta: {
        confidence: typeof row.confidence === "number" ? row.confidence : null,
        status: typeof row.status === "string" ? str(row.status) : null,
      },
    }),
  },
  alerts: {
    displayType: "alerts",
    fields: [{ field: "title" }, { field: "message" }],
    toResult: (row) => ({
      id: str(row.id),
      type: "alerts",
      title: str(row.title),
      subtitle: str(row.message),
      timestamp: ts(row.createdAt),
      meta: {
        severity: typeof row.severity === "string" ? str(row.severity) : null,
        isRead: typeof row.isRead === "boolean" ? (row.isRead ? "true" : "false") : null,
      },
    }),
  },
  incidents: {
    displayType: "incidents",
    fields: [{ field: "title" }, { field: "description" }, { field: "resolutionSummary" }],
    toResult: (row) => ({
      id: str(row.id),
      type: "incidents",
      title: str(row.title),
      subtitle: str(row.description) || str(row.resolutionSummary),
      timestamp: ts(row.createdAt),
      meta: {
        status: typeof row.status === "string" ? str(row.status) : null,
        priority: typeof row.priority === "string" ? str(row.priority) : null,
      },
    }),
  },
  cameras: {
    displayType: "cameras",
    fields: [{ field: "name" }, { field: "location" }],
    toResult: (row) => ({
      id: str(row.id),
      type: "cameras",
      title: str(row.name),
      subtitle: str(row.location),
      timestamp: ts(row.createdAt),
      meta: {
        status: typeof row.status === "string" ? str(row.status) : null,
        cameraType: typeof row.cameraType === "string" ? str(row.cameraType) : null,
      },
    }),
  },
  audit: {
    displayType: "audit",
    fields: [{ field: "description" }, { field: "username" }, { field: "email" }, { field: "module" }],
    toResult: (row) => ({
      id: str(row.id),
      type: "audit",
      title: str(row.description),
      subtitle: [str(row.username) ? `User: ${str(row.username)}` : "", `Module: ${str(row.module)}`]
        .filter(Boolean)
        .join(" · "),
      timestamp: ts(row.timestamp),
      meta: {
        action: typeof row.action === "string" ? str(row.action) : null,
        status: typeof row.status === "string" ? str(row.status) : null,
      },
    }),
  },
  users: {
    displayType: "users",
    fields: [{ field: "name" }, { field: "email" }],
    toResult: (row) => ({
      id: str(row.id),
      type: "users",
      title: str(row.name),
      subtitle: str(row.email),
      timestamp: ts(row.createdAt),
      meta: {
        status: typeof row.status === "string" ? str(row.status) : null,
        role: typeof row.role === "string" ? str(row.role) : null,
      },
    }),
  },
};

export function buildSearchWhere(spec: EntitySearchSpec, rawTerm: string): SearchWhere {
  const term = rawTerm.trim();
  return {
    OR: spec.fields.map((f) => ({ [f.field]: { contains: term, mode: "insensitive" } })),
  };
}

export function resolveSearchTypes(
  typeFilter: string | undefined,
): SearchEntityType[] {
  if (!typeFilter || typeFilter === "all") return [...SEARCH_ENTITY_TYPES];
  const match = SEARCH_ENTITY_TYPES.find((t) => t === typeFilter);
  return match ? [match] : [];
}

/** Trims sections to only those the caller's role may read. */
export function trimToPermissions(
  sections: SearchSection[],
  permissions: Set<string> | undefined,
): SearchSection[] {
  if (!permissions || permissions.size === 0) return [];
  return sections.filter((s) => permissions.has(s.permission)).map((s) => ({ ...s }));
}