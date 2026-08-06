import type { SystemSettingCategory } from "@prisma/client";

export type SettingType = "boolean" | "number" | "string" | "select" | "color";

export type SettingValue = string | number | boolean;

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  type: SettingType;
  defaultValue: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: SettingOption[];
}

export interface SettingsCategoryDefinition {
  key: SystemSettingCategory;
  label: string;
  icon: string;
  description: string;
  settings: SettingDefinition[];
}

const processorOptions: SettingOption[] = [
  { value: "auto", label: "Auto (recommended)" },
  { value: "gpu", label: "GPU" },
  { value: "cpu", label: "CPU only" },
];

const themeColorOptions: SettingOption[] = [
  { value: "#2563eb", label: "Blue (default)" },
  { value: "#0f766e", label: "Teal" },
  { value: "#7c3aed", label: "Violet" },
  { value: "#dc2626", label: "Red" },
  { value: "#16a34a", label: "Green" },
  { value: "#ea580c", label: "Orange" },
];

export const settingsCategories: SettingsCategoryDefinition[] = [
  {
    key: "general",
    label: "General",
    icon: "settings",
    description: "Application identity, language and appearance",
    settings: [
      {
        key: "system_name",
        label: "System name",
        description: "Name shown in the application header and emails.",
        type: "string",
        defaultValue: "VigiLens",
      },
      {
        key: "organization_name",
        label: "Organization name",
        description: "Your organization used in reports and email footers.",
        type: "string",
        defaultValue: "VigiLens",
      },
      {
        key: "language",
        label: "Language",
        description: "Default language for the application interface.",
        type: "select",
        defaultValue: "en",
        options: [
          { value: "en", label: "English" },
          { value: "es", label: "Español" },
          { value: "fr", label: "Français" },
          { value: "de", label: "Deutsch" },
          { value: "hi", label: "हिन्दी" },
          { value: "zh", label: "中文" },
        ],
      },
      {
        key: "timezone",
        label: "Timezone",
        description: "Used for timestamps, summaries and scheduled reports.",
        type: "select",
        defaultValue: "UTC",
        options: [
          { value: "UTC", label: "UTC (Coordinated Universal Time)" },
          { value: "America/New_York", label: "Eastern Time (US)" },
          { value: "America/Chicago", label: "Central Time (US)" },
          { value: "America/Denver", label: "Mountain Time (US)" },
          { value: "America/Los_Angeles", label: "Pacific Time (US)" },
          { value: "Asia/Kolkata", label: "India (IST)" },
          { value: "Asia/Shanghai", label: "China (CST)" },
          { value: "Europe/London", label: "London (GMT)" },
          { value: "Europe/Berlin", label: "Central Europe (CET)" },
          { value: "Australia/Sydney", label: "Sydney (AEST)" },
        ],
      },
      {
        key: "theme_color",
        label: "Theme color",
        description: "Accent color used across the interface (theme support ready).",
        type: "color",
        defaultValue: "#2563eb",
        options: themeColorOptions,
      },
    ],
  },
  {
    key: "security",
    label: "Security",
    icon: "shield",
    description: "Sessions, passwords, rate limits and token lifetimes",
    settings: [
      {
        key: "session_timeout_minutes",
        label: "Session timeout",
        description: "Minutes of inactivity before an admin session expires.",
        type: "number",
        defaultValue: 30,
        min: 5,
        max: 1440,
        step: 5,
        unit: "min",
      },
      {
        key: "password_min_length",
        label: "Minimum password length",
        description: "Minimum number of characters required for new passwords.",
        type: "number",
        defaultValue: 8,
        min: 6,
        max: 128,
        unit: "chars",
      },
      {
        key: "password_require_complexity",
        label: "Require complex passwords",
        description: "Force passwords to include upper/lower case, numbers and symbols.",
        type: "boolean",
        defaultValue: true,
      },
      {
        key: "max_login_attempts",
        label: "Login attempt limit",
        description: "Failed login attempts before the account is temporarily locked.",
        type: "number",
        defaultValue: 5,
        min: 1,
        max: 20,
        unit: "attempts",
      },
      {
        key: "lockout_duration_minutes",
        label: "Lockout duration",
        description: "How long an account stays locked after exceeding login attempts.",
        type: "number",
        defaultValue: 15,
        min: 1,
        max: 1440,
        unit: "min",
      },
      {
        key: "rate_limit_window_ms",
        label: "API rate limit window",
        description: "Time window used for per-client API rate limiting.",
        type: "number",
        defaultValue: 900000,
        min: 60000,
        max: 86400000,
        step: 60000,
        unit: "ms",
      },
      {
        key: "rate_limit_max_requests",
        label: "API rate limit max requests",
        description: "Maximum requests per client inside the rate limit window.",
        type: "number",
        defaultValue: 100,
        min: 10,
        max: 10000,
        unit: "req",
      },
      {
        key: "jwt_expiration_hours",
        label: "JWT expiration",
        description: "Lifetime of issued access tokens.",
        type: "number",
        defaultValue: 168,
        min: 1,
        max: 720,
        unit: "hrs",
      },
      {
        key: "jwt_require_https",
        label: "Require HTTPS for login",
        description: "Reject login attempts over plain HTTP when enabled.",
        type: "boolean",
        defaultValue: true,
      },
    ],
  },
  {
    key: "ai_detection",
    label: "AI Detection",
    icon: "brain",
    description: "Detection engine defaults, processors and data retention",
    settings: [
      {
        key: "global_confidence_threshold",
        label: "Global confidence threshold",
        description: "Detections below this confidence are ignored across all detectors.",
        type: "number",
        defaultValue: 50,
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
      },
      {
        key: "default_detector",
        label: "Default detector",
        description: "Detector enabled by default for newly connected cameras.",
        type: "select",
        defaultValue: "person",
        options: [
          { value: "person", label: "Person Detection" },
          { value: "fire", label: "Fire Detection" },
          { value: "smoking", label: "Smoking Detection" },
          { value: "helmet", label: "Helmet Detection" },
          { value: "face_mask", label: "Face Mask Detection" },
          { value: "vehicle", label: "Vehicle Detection" },
          { value: "intrusion", label: "Intrusion Detection" },
          { value: "drowsiness", label: "Drowsiness Detection" },
        ],
      },
      {
        key: "preferred_processor",
        label: "GPU / CPU mode",
        description: "Preferred processor for inference across all detectors.",
        type: "select",
        defaultValue: "auto",
        options: processorOptions,
      },
      {
        key: "detection_fps",
        label: "Detection FPS",
        description: "Frames processed per second by the detection pipeline.",
        type: "number",
        defaultValue: 5,
        min: 1,
        max: 60,
        unit: "fps",
      },
      {
        key: "image_retention_days",
        label: "Image retention period",
        description: "How long detection snapshots are kept before automatic cleanup.",
        type: "number",
        defaultValue: 7,
        min: 1,
        max: 365,
        unit: "days",
      },
      {
        key: "video_retention_days",
        label: "Video retention period",
        description: "How long recorded video segments are kept before automatic cleanup.",
        type: "number",
        defaultValue: 30,
        min: 1,
        max: 730,
        unit: "days",
      },
      {
        key: "snapshot_quality",
        label: "Snapshot quality",
        description: "JPEG quality used when saving detection snapshots.",
        type: "number",
        defaultValue: 85,
        min: 10,
        max: 100,
        unit: "%",
      },
      {
        key: "auto_cleanup_enabled",
        label: "Automatic cleanup",
        description: "Periodically purge expired images, videos and detections.",
        type: "boolean",
        defaultValue: true,
      },
    ],
  },
  {
    key: "notifications",
    label: "Notifications",
    icon: "bell",
    description: "Email alerts, summaries and scheduled reports",
    settings: [
      {
        key: "email_alerts_enabled",
        label: "Email alerts",
        description: "Send alert notifications by email when enabled.",
        type: "boolean",
        defaultValue: true,
      },
      {
        key: "critical_alert_enabled",
        label: "Critical alerts",
        description: "Email for critical severity detections and alerts.",
        type: "boolean",
        defaultValue: true,
      },
      {
        key: "warning_alert_enabled",
        label: "Warning alerts",
        description: "Email for warning severity detections and alerts.",
        type: "boolean",
        defaultValue: true,
      },
      {
        key: "daily_summary_enabled",
        label: "Daily summary",
        description: "Send a summary of the day's activity every morning.",
        type: "boolean",
        defaultValue: true,
      },
      {
        key: "weekly_report_enabled",
        label: "Weekly report",
        description: "Send a comprehensive report each week.",
        type: "boolean",
        defaultValue: true,
      },
      {
        key: "digest_time",
        label: "Digest time",
        description: "Local time for daily summary and weekly report delivery.",
        type: "string",
        defaultValue: "08:00",
      },
    ],
  },
  {
    key: "cameras",
    label: "Cameras",
    icon: "camera",
    description: "Stream defaults, connectivity and preview behavior",
    settings: [
      {
        key: "default_capture_fps",
        label: "Default capture FPS",
        description: "Frame rate applied to newly registered cameras.",
        type: "number",
        defaultValue: 30,
        min: 1,
        max: 120,
        unit: "fps",
      },
      {
        key: "max_connected_cameras",
        label: "Max connected cameras",
        description: "Hard limit on concurrently connected cameras.",
        type: "number",
        defaultValue: 16,
        min: 1,
        max: 256,
        unit: "cameras",
      },
      {
        key: "camera_reconnect_timeout_seconds",
        label: "Reconnect timeout",
        description: "Seconds to wait before retrying an offline camera.",
        type: "number",
        defaultValue: 30,
        min: 5,
        max: 600,
        unit: "sec",
      },
      {
        key: "thumbnail_refresh_seconds",
        label: "Thumbnail refresh",
        description: "How often camera thumbnails are refreshed in the UI.",
        type: "number",
        defaultValue: 10,
        min: 1,
        max: 3600,
        unit: "sec",
      },
    ],
  },
  {
    key: "storage",
    label: "Storage",
    icon: "database",
    description: "Media paths, quotas and automated cleanup",
    settings: [
      {
        key: "storage_base_path",
        label: "Storage base path",
        description: "Root directory for snapshots, videos and recordings.",
        type: "string",
        defaultValue: "/data/vigilens",
      },
      {
        key: "max_storage_gb",
        label: "Maximum storage",
        description: "Soft quota for all stored media before cleanup is forced.",
        type: "number",
        defaultValue: 100,
        min: 1,
        max: 10000,
        unit: "GB",
      },
      {
        key: "low_storage_threshold_gb",
        label: "Low storage threshold",
        description: "Raise a warning alert when free space drops below this.",
        type: "number",
        defaultValue: 10,
        min: 1,
        max: 500,
        unit: "GB",
      },
      {
        key: "cleanup_interval_days",
        label: "Cleanup interval",
        description: "How often the automated media cleanup job runs.",
        type: "number",
        defaultValue: 1,
        min: 1,
        max: 30,
        unit: "days",
      },
    ],
  },
  {
    key: "email",
    label: "Email",
    icon: "mail",
    description: "SMTP server and notification recipients",
    settings: [
      {
        key: "smtp_host",
        label: "SMTP host",
        description: "Hostname of the outbound mail server.",
        type: "string",
        defaultValue: "smtp.example.com",
      },
      {
        key: "smtp_port",
        label: "SMTP port",
        description: "TCP port of the outbound mail server.",
        type: "number",
        defaultValue: 587,
        min: 1,
        max: 65535,
        unit: "port",
      },
      {
        key: "smtp_secure",
        label: "Secure connection (TLS)",
        description: "Use TLS when communicating with the mail server.",
        type: "boolean",
        defaultValue: true,
      },
      {
        key: "smtp_username",
        label: "SMTP username",
        description: "Account used to authenticate with the mail server.",
        type: "string",
        defaultValue: "",
      },
      {
        key: "smtp_from_email",
        label: "From address",
        description: "Email address used in the From header.",
        type: "string",
        defaultValue: "vigilens@example.com",
      },
      {
        key: "notifications_email",
        label: "Notification recipient",
        description: "Primary recipient for alerts, summaries and reports.",
        type: "string",
        defaultValue: "",
      },
    ],
  },
  {
    key: "backup",
    label: "Backup",
    icon: "archive",
    description: "Automatic backup scheduling and retention",
    settings: [
      {
        key: "auto_backup_enabled",
        label: "Automatic backups",
        description: "Schedule periodic database and configuration backups.",
        type: "boolean",
        defaultValue: false,
      },
      {
        key: "backup_interval_days",
        label: "Backup interval",
        description: "Days between automatic backups.",
        type: "number",
        defaultValue: 7,
        min: 1,
        max: 90,
        unit: "days",
      },
      {
        key: "backup_time",
        label: "Backup time",
        description: "Local time of day when automatic backups run.",
        type: "string",
        defaultValue: "02:00",
      },
      {
        key: "backup_retention_count",
        label: "Backup retention",
        description: "Number of completed backups to keep on disk.",
        type: "number",
        defaultValue: 7,
        min: 1,
        max: 90,
        unit: "backups",
      },
    ],
  },
];

const settingsByCategory = new Map<SystemSettingCategory, SettingsCategoryDefinition>(
  settingsCategories.map((cat) => [cat.key, cat]),
);

const settingsByKey = new Map<string, SettingDefinition>();
for (const cat of settingsCategories) {
  for (const setting of cat.settings) {
    settingsByKey.set(`${cat.key}:${setting.key}`, setting);
  }
}

export function getSettingCategories(): SettingsCategoryDefinition[] {
  return settingsCategories;
}

export function getSettingCategory(category: SystemSettingCategory): SettingsCategoryDefinition | undefined {
  return settingsByCategory.get(category);
}

export function getSettingDefinition(
  category: SystemSettingCategory,
  key: string,
): SettingDefinition | undefined {
  return settingsByKey.get(`${category}:${key}`);
}

export function isValidSettingValue(def: SettingDefinition, value: unknown): value is SettingValue {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return false;
  }
  switch (def.type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      if (def.min !== undefined && value < def.min) return false;
      if (def.max !== undefined && value > def.max) return false;
      return true;
    case "color":
      return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
    case "select":
      return (
        typeof value === "string" &&
        (def.options?.some((option) => option.value === value) ?? false)
      );
    case "string":
      return typeof value === "string" && value.length <= 500;
  }
}
