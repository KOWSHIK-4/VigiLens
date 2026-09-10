import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

interface PeriodParams {
  from?: string;
  to?: string;
  period?: "7" | "30" | "90";
  tz?: string;
}

export interface OverviewResult {
  totalDetections: number;
  todayDetections: number;
  activeCameras: number;
  offlineCameras: number;
  totalCameras: number;
  averageConfidence: number;
  detectionRate: number;
  mostActiveCamera: { name: string; count: number };
  mostCommonDetectionType: string;
  severityDistribution: { name: string; value: number }[];
}

export interface DailyResult {
  date: string;
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface CameraAnalyticsResult {
  id: string;
  name: string;
  location: string | null;
  status: string;
  detectionCount: number;
  percentageOfMax: number;
}

export interface DetectorResult {
  label: string;
  count: number;
  percentage: number;
  avgConfidence: number;
  minConfidence: number;
  maxConfidence: number;
}

export interface TimelineResult {
  hour: string;
  value: number;
}

export interface ConfidenceBucket {
  range: string;
  count: number;
  percentage: number;
}

type CacheData =
  | OverviewResult
  | DailyResult[]
  | CameraAnalyticsResult[]
  | DetectorResult[]
  | TimelineResult[]
  | ConfidenceBucket[];

const cache = new Map<string, { data: CacheData; expiresAt: number }>();
// Distinct from/to combinations are unbounded; cap the cache and sweep
// expired/oldest entries so long-running processes cannot leak memory.
const CACHE_MAX_ENTRIES = 200;

function cacheGet<T extends CacheData>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function cacheSet(key: string, data: CacheData, ttl = 60_000): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [existingKey, entry] of cache) {
      if (Date.now() > entry.expiresAt) cache.delete(existingKey);
    }
    while (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(key, { data, expiresAt: Date.now() + ttl });
}

/**
 * Stable cache-range component for a params object. `period` wins;
 * otherwise the explicit from/to timestamps form the key. Without this,
 * two requests with different `from` values would share one cached
 * result computed for whichever arrived first. A `tz` (when present) is
 * folded into the key so zone-specific windows do not share a cache entry.
 */
export function rangeKeyFor(params: PeriodParams): string {
  const tzSuffix = params.tz ? `|tz:${params.tz}` : "";
  if (params.period) return `p${params.period}${tzSuffix}`;
  const from = params.from ? new Date(params.from).toISOString() : "all";
  const to = params.to ? new Date(params.to).toISOString() : "all";
  return `${from}..${to}${tzSuffix}`;
}

/** True when the string is a time zone the runtime can resolve. */
export function validTimezone(tz?: string): boolean {
  if (tz === undefined) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Returns `tz` when valid, otherwise undefined so callbacks never throw. */
function resolveTimezone(tz?: string): string | undefined {
  return validTimezone(tz) ? tz : undefined;
}

function zonedParts(date: Date, tz: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

/** Offset in milliseconds of `tz` at the given absolute instant. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/**
 * Absolute instant of the start of the local calendar day containing `date`
 * in `tz` (DST-aware). Used so "today", "last 7/30/90 days" and explicit
 * `to` bounds align with the reporting user's clock rather than the server's.
 */
export function startOfDayInTz(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  const localMidnightUtc = Date.UTC(p.year, p.month - 1, p.day);
  return new Date(localMidnightUtc - tzOffsetMs(new Date(localMidnightUtc), tz));
}

/** Instant one millisecond before the start of the next local day in `tz`. */
export function endOfDayInTz(date: Date, tz: string): Date {
  return new Date(startOfDayInTz(date, tz).getTime() + 86400000 - 1);
}

function getDateRange(days: number, tz?: string): { from: Date; to: Date } {
  const to = new Date();
  if (tz) {
    const from = startOfDayInTz(new Date(to.getTime() - days * 86400000), tz);
    return { from, to };
  }
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

/**
 * Resolves the period/from/to params into a timestamp filter. The `period`
 * wins; otherwise explicit `from`/`to` bounds are honoured, with `to` clamped
 * to the end of its day (in the requested time zone when one is given, else
 * server-local, matching the detection list filter). When no filter applies
 * the helpers return undefined so callers keep their all-time scope.
 */
function periodDateFilter(params: PeriodParams): { gte?: Date; lte?: Date } | undefined {
  const tz = resolveTimezone(params.tz);
  if (params.period) {
    const { from, to } = getDateRange(parseInt(params.period), tz);
    return { gte: from, lte: to };
  }
  const gte = params.from ? new Date(params.from) : undefined;
  const rawLte = params.to ? new Date(params.to) : undefined;
  let lte: Date | undefined;
  if (rawLte) {
    if (tz) {
      lte = endOfDayInTz(rawLte, tz);
    } else {
      rawLte.setHours(23, 59, 59, 999);
      lte = rawLte;
    }
  }
  if (gte || lte) return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
  return undefined;
}

/** Builds the full raw-SQL `WHERE ...` clause for a resolved date filter. */
function dateWhereSql(filter: { gte?: Date; lte?: Date } | undefined): Prisma.Sql {
  if (!filter) return Prisma.empty;
  if (filter.gte && filter.lte) {
    return Prisma.sql`WHERE timestamp >= ${filter.gte} AND timestamp <= ${filter.lte}`;
  }
  if (filter.gte) return Prisma.sql`WHERE timestamp >= ${filter.gte}`;
  if (filter.lte) return Prisma.sql`WHERE timestamp <= ${filter.lte}`;
  return Prisma.empty;
}

/** Number of days spanned by the active period/from/to filter (for rates). */
function windowDaysFor(params: PeriodParams): number | undefined {
  if (params.period) return parseInt(params.period);
  if (params.from || params.to) {
    const start = params.from ? new Date(params.from).getTime() : Date.now();
    const end = params.to ? new Date(params.to).getTime() : Date.now();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
    return Math.max(1, Math.round((end - start) / 86400000));
  }
  return undefined;
}

export const analyticsService = {
  async getOverview(params: PeriodParams = {}): Promise<OverviewResult> {
    const cacheKey = `analytics:overview:${rangeKeyFor(params)}`;
    const cached = cacheGet<OverviewResult>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const tz = resolveTimezone(params.tz);
    const todayStart = tz
      ? startOfDayInTz(now, tz)
      : (() => {
          const d = new Date(now);
          d.setHours(0, 0, 0, 0);
          return d;
        })();
    const filter = periodDateFilter(params);
    const scopeWhere = filter ? { timestamp: filter } : undefined;
    const windowDays = windowDaysFor(params);

    const [
      totalDetections,
      todayDetections,
      statusCounts,
      avgConfidence,
      topCamera,
      topLabel,
      cameraTotal,
      severityCounts,
    ] = await Promise.all([
      prisma.detection.count({ where: scopeWhere }),
      prisma.detection.count({ where: { timestamp: { gte: todayStart } } }),
      prisma.camera.groupBy({ by: ["status"], _count: { id: true } }),
      prisma.detection.aggregate({
        _avg: { confidence: true },
        where: scopeWhere,
      }),
      prisma.detection.groupBy({
        by: ["cameraId"],
        _count: { id: true },
        where: scopeWhere,
        orderBy: { _count: { id: "desc" } },
        take: 1,
      }),
      prisma.detection.groupBy({
        by: ["label"],
        _count: { id: true },
        where: scopeWhere,
        orderBy: { _count: { id: "desc" } },
        take: 1,
      }),
      prisma.camera.count(),
      prisma.detection.groupBy({ by: ["status"], _count: { id: true }, where: scopeWhere }),
    ]);

    let mostActiveCamera: { name: string; count: number } = { name: "N/A", count: 0 };
    if (topCamera.length > 0) {
      const cam = await prisma.camera.findUnique({ where: { id: topCamera[0].cameraId } });
      if (cam) mostActiveCamera = { name: cam.name, count: topCamera[0]._count.id };
    }

    const onlineCount = statusCounts.find((s) => s.status === "online")?._count.id ?? 0;
    const offlineCount = statusCounts
      .filter((s) => s.status === "offline" || s.status === "error")
      .reduce((sum, s) => sum + s._count.id, 0);

    // With an explicit window the scoped total IS the per-window count; without
    // one keep the historical fixed 7-day rolling average.
    let detectionRate: number;
    if (windowDays !== undefined) {
      detectionRate = totalDetections / windowDays;
    } else {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
      const sevenDayCount = await prisma.detection.count({
        where: { timestamp: { gte: sevenDaysAgo } },
      });
      detectionRate = sevenDayCount / 7;
    }

    const result: OverviewResult = {
      totalDetections,
      todayDetections,
      activeCameras: onlineCount,
      offlineCameras: offlineCount,
      totalCameras: cameraTotal,
      averageConfidence: avgConfidence._avg.confidence ?? 0,
      detectionRate,
      mostActiveCamera,
      mostCommonDetectionType: topLabel.length > 0 ? topLabel[0].label : "N/A",
      severityDistribution: severityCounts.map((s) => ({
        name: s.status,
        value: s._count.id,
      })),
    };

    cacheSet(cacheKey, result, 30_000);
    return result;
  },

  async getDaily(params: PeriodParams): Promise<DailyResult[]> {
    const cacheKey = `analytics:daily:${rangeKeyFor(params)}`;
    const cached = cacheGet<DailyResult[]>(cacheKey);
    if (cached) return cached;

    const where = dateWhereSql(periodDateFilter(params));
    // When a time zone is requested, bucket calendar days in that zone
    // instead of the database's server time zone.
    const dayExpr = params.tz
      ? Prisma.sql`DATE(timestamp AT TIME ZONE ${params.tz})`
      : Prisma.sql`DATE(timestamp)`;

    const rows = await prisma.$queryRaw<
      { date: string; count: number; critical: number; warning: number; info: number }[]
    >`
      SELECT
        ${dayExpr} as date,
        COUNT(*)::int as count,
        COUNT(*) FILTER (WHERE status = 'critical')::int as critical,
        COUNT(*) FILTER (WHERE status = 'warning')::int as warning,
        COUNT(*) FILTER (WHERE status = 'info')::int as info
      FROM detections
      ${where}
      GROUP BY ${dayExpr}
      ORDER BY date ASC
    `;

    const result: DailyResult[] = rows.map((r) => ({
      date: r.date,
      total: r.count,
      critical: r.critical,
      warning: r.warning,
      info: r.info,
    }));

    cacheSet(cacheKey, result, 60_000);
    return result;
  },

  async getCameras(params: PeriodParams): Promise<CameraAnalyticsResult[]> {
    const cacheKey = `analytics:cameras:${rangeKeyFor(params)}`;
    const cached = cacheGet<CameraAnalyticsResult[]>(cacheKey);
    if (cached) return cached;

    const dateFilter = periodDateFilter(params);

    const cameraStats = await prisma.camera.findMany({
      include: {
        _count: {
          select: {
            detections: dateFilter ? { where: { timestamp: dateFilter } } : true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    let maxDetections = 0;
    for (const cam of cameraStats) {
      if (cam._count.detections > maxDetections) maxDetections = cam._count.detections;
    }

    const result: CameraAnalyticsResult[] = cameraStats.map((cam) => ({
      id: cam.id,
      name: cam.name,
      location: cam.location,
      status: cam.status,
      detectionCount: cam._count.detections,
      percentageOfMax:
        maxDetections > 0 ? Math.round((cam._count.detections / maxDetections) * 100) : 0,
    }));

    cacheSet(cacheKey, result, 60_000);
    return result;
  },

  async getDetectors(params: PeriodParams): Promise<DetectorResult[]> {
    const cacheKey = `analytics:detectors:${rangeKeyFor(params)}`;
    const cached = cacheGet<DetectorResult[]>(cacheKey);
    if (cached) return cached;

    const dateFilter = periodDateFilter(params);

    const where = dateFilter ? { timestamp: dateFilter } : {};

    const labelStats = await prisma.detection.groupBy({
      by: ["label"],
      _count: { id: true },
      _avg: { confidence: true },
      _min: { confidence: true },
      _max: { confidence: true },
      where,
      orderBy: { _count: { id: "desc" } },
    });

    const total = labelStats.reduce((sum, l) => sum + l._count.id, 0);

    const result: DetectorResult[] = labelStats.map((l) => ({
      label: l.label,
      count: l._count.id,
      percentage: total > 0 ? Math.round((l._count.id / total) * 100 * 100) / 100 : 0,
      avgConfidence: Math.round((l._avg.confidence ?? 0) * 10000) / 10000,
      minConfidence: l._min.confidence ?? 0,
      maxConfidence: l._max.confidence ?? 0,
    }));

    cacheSet(cacheKey, result, 60_000);
    return result;
  },

  async getTimeline(params: PeriodParams): Promise<TimelineResult[]> {
    const cacheKey = `analytics:timeline:${rangeKeyFor(params)}`;
    const cached = cacheGet<TimelineResult[]>(cacheKey);
    if (cached) return cached;

    const where = dateWhereSql(periodDateFilter(params));
    // Hour-of-day distribution in the requested zone (e.g. DST-aware local
    // time) rather than the database server's time zone.
    const hourExpr = params.tz
      ? Prisma.sql`EXTRACT(HOUR FROM timestamp AT TIME ZONE ${params.tz})::int`
      : Prisma.sql`EXTRACT(HOUR FROM timestamp)::int`;

    const rows = await prisma.$queryRaw<{ hour: number; count: number }[]>`
      SELECT ${hourExpr} as hour, COUNT(*)::int as count
      FROM detections
      ${where}
      GROUP BY ${hourExpr}
      ORDER BY hour ASC
    `;

    const hourlyMap = new Map<number, number>();
    for (const r of rows) hourlyMap.set(r.hour, r.count);

    const result: TimelineResult[] = Array.from({ length: 24 }, (_, i) => ({
      hour: `${i.toString().padStart(2, "0")}:00`,
      value: hourlyMap.get(i) ?? 0,
    }));

    cacheSet(cacheKey, result, 60_000);
    return result;
  },

  async getConfidenceDistribution(params: PeriodParams): Promise<ConfidenceBucket[]> {
    const cacheKey = `analytics:confidence:${rangeKeyFor(params)}`;
    const cached = cacheGet<ConfidenceBucket[]>(cacheKey);
    if (cached) return cached;

    const where = dateWhereSql(periodDateFilter(params));

    // Single-pass aggregation in PostgreSQL instead of loading every
    // detection row into Node memory.
    const rows = await prisma.$queryRaw<
      Array<{ b0: bigint; b1: bigint; b2: bigint; b3: bigint; b4: bigint; b5: bigint; total: bigint }>
    >`
      SELECT
        COUNT(*) FILTER (WHERE confidence >= 0    AND confidence < 0.2) AS "b0",
        COUNT(*) FILTER (WHERE confidence >= 0.2  AND confidence < 0.4) AS "b1",
        COUNT(*) FILTER (WHERE confidence >= 0.4  AND confidence < 0.6) AS "b2",
        COUNT(*) FILTER (WHERE confidence >= 0.6  AND confidence < 0.8) AS "b3",
        COUNT(*) FILTER (WHERE confidence >= 0.8  AND confidence < 0.9) AS "b4",
        COUNT(*) FILTER (WHERE confidence >= 0.9)                        AS "b5",
        COUNT(*)                                                         AS "total"
      FROM detections
      ${where}
    `;

    const counts = rows[0] ?? { b0: 0n, b1: 0n, b2: 0n, b3: 0n, b4: 0n, b5: 0n, total: 0n };
    const total = Number(counts.total);
    const ranges = ["0-20%", "20-40%", "40-60%", "60-80%", "80-90%", "90-100%"];
    const bucketCounts = [counts.b0, counts.b1, counts.b2, counts.b3, counts.b4, counts.b5].map(Number);

    const result: ConfidenceBucket[] = ranges.map((range, i) => ({
      range,
      count: bucketCounts[i],
      percentage: total > 0 ? Math.round((bucketCounts[i] / total) * 10000) / 100 : 0,
    }));

    cacheSet(cacheKey, result, 120_000);
    return result;
  },
};
