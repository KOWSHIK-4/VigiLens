import api from "./api";
import type {
  AnalyticsOverview,
  DailyDetection,
  CameraAnalytics,
  DetectorStat,
  TimelineHour,
  ConfidenceBucket,
  AnalyticsParams,
} from "@/types";

export const analyticsService = {
  async getOverview(): Promise<AnalyticsOverview> {
    const { data } = await api.get("/analytics/overview");
    return data.data;
  },

  async getDaily(params?: AnalyticsParams): Promise<DailyDetection[]> {
    const { data } = await api.get("/analytics/daily", { params });
    return data.data;
  },

  async getCameras(params?: AnalyticsParams): Promise<CameraAnalytics[]> {
    const { data } = await api.get("/analytics/cameras", { params });
    return data.data;
  },

  async getDetectors(params?: AnalyticsParams): Promise<DetectorStat[]> {
    const { data } = await api.get("/analytics/detectors", { params });
    return data.data;
  },

  async getTimeline(params?: AnalyticsParams): Promise<TimelineHour[]> {
    const { data } = await api.get("/analytics/timeline", { params });
    return data.data;
  },

  async getConfidenceDistribution(params?: AnalyticsParams): Promise<ConfidenceBucket[]> {
    const { data } = await api.get("/analytics/confidence", { params });
    return data.data;
  },
};
