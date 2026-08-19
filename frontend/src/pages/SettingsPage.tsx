import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  Bell,
  Brain,
  Camera,
  HardDrive,
  Loader2,
  Mail,
  Palette,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { settingsService } from "@/services/settings";
import { showToast } from "@/utils/toast";
import { getApiErrorMessage } from "@/utils/apiError";
import type {
  SettingsCategory,
  SettingsUpdateInput,
  SettingsValue,
  SystemSetting,
} from "@/types";

type SettingsMap = Record<string, SettingsValue>;

const CATEGORY_KEYS: SettingsCategory[] = [
  "general",
  "security",
  "ai_detection",
  "notifications",
  "cameras",
  "storage",
  "email",
  "backup",
];

interface CategoryMeta {
  label: string;
  description: string;
  icon: typeof Settings;
}

const CATEGORY_META: Record<SettingsCategory, CategoryMeta> = {
  general: {
    label: "General",
    description: "Identity, language and appearance",
    icon: Settings,
  },
  security: {
    label: "Security",
    description: "Sessions, passwords, rate limits",
    icon: ShieldCheck,
  },
  ai_detection: {
    label: "AI Detection",
    description: "Engine defaults and retention",
    icon: Brain,
  },
  notifications: {
    label: "Notifications",
    description: "Alerts, summaries and reports",
    icon: Bell,
  },
  cameras: {
    label: "Cameras",
    description: "Stream defaults and connectivity",
    icon: Camera,
  },
  storage: {
    label: "Storage",
    description: "Paths, quotas and cleanup",
    icon: HardDrive,
  },
  email: {
    label: "Email",
    description: "SMTP server and recipients",
    icon: Mail,
  },
  backup: {
    label: "Backup",
    description: "Automatic backup scheduling",
    icon: Archive,
  },
};

function ModifiedChip() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-700">
      Modified
    </span>
  );
}

function SettingField({
  setting,
  value,
  onChange,
  modified,
}: {
  setting: SystemSetting;
  value: SettingsValue;
  onChange: (value: SettingsValue) => void;
  modified?: boolean;
}) {
  if (setting.type === "boolean") {
    const checked = Boolean(value);
    return (
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">
            {setting.label}
            {modified && <ModifiedChip />}
          </p>
          <p className="text-xs text-gray-500 mt-1">{setting.description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={setting.label}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
            checked ? "bg-brand-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              checked ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
    );
  }

  if (setting.type === "number") {
    return (
      <div>
        <div className="flex items-center justify-between gap-4">
          <label className="text-sm font-medium text-gray-900">
            {setting.label}
            {modified && <ModifiedChip />}
          </label>
          <span className="text-xs text-gray-400">
            {setting.min !== undefined && setting.max !== undefined
              ? `${setting.min} – ${setting.max}`
              : setting.unit
                ? setting.unit
                : ""}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="number"
            min={setting.min}
            max={setting.max}
            step={setting.step ?? 1}
            value={String(value)}
            onChange={(e) => {
              if (e.target.value === "") return;
              const next = Number(e.target.value);
              if (Number.isFinite(next)) onChange(next);
            }}
            className="input max-w-[180px]"
            aria-label={setting.label}
          />
          {setting.unit && (
            <span className="text-sm text-gray-500 w-14 flex-shrink-0">{setting.unit}</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1.5">{setting.description}</p>
      </div>
    );
  }

  if (setting.type === "select") {
    return (
      <div>
        <label className="text-sm font-medium text-gray-900">
          {setting.label}
          {modified && <ModifiedChip />}
        </label>
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="input mt-1.5"
          aria-label={setting.label}
        >
          {setting.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1.5">{setting.description}</p>
      </div>
    );
  }

  if (setting.type === "color") {
    return (
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
          <Palette className="w-4 h-4 text-brand-600" />
          {setting.label}
          {modified && <ModifiedChip />}
        </label>
        <div className="mt-2 flex items-center gap-2">
          {setting.options?.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              title={option.label}
              aria-label={`${setting.label}: ${option.label}`}
              className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
                String(value).toLowerCase() === option.value.toLowerCase()
                  ? "border-gray-900 scale-110"
                  : "border-gray-200"
              }`}
              style={{ backgroundColor: option.value }}
            />
          ))}
          <input
            type="color"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-8 cursor-pointer rounded-full border border-gray-200"
            aria-label={`${setting.label} custom color`}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1.5">{setting.description}</p>
      </div>
    );
  }

  return (
    <div>
      <label className="text-sm font-medium text-gray-900">
        {setting.label}
        {modified && <ModifiedChip />}
      </label>
      <input
        type="text"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-1.5"
        aria-label={setting.label}
      />
      <p className="text-xs text-gray-500 mt-1.5">{setting.description}</p>
    </div>
  );
}

function SkeletonField() {
  return (
    <div className="animate-pulse space-y-3 py-2">
      <div className="h-4 bg-gray-200 rounded w-1/3" />
      <div className="h-9 bg-gray-200 rounded w-2/3" />
    </div>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("general");
  const [search, setSearch] = useState("");
  const [values, setValues] = useState<SettingsMap>({});
  const [confirmLeave, setConfirmLeave] = useState(false);
  const initialValuesRef = useRef<SettingsMap | null>(null);

  const {
    data: settings,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsService.getAll(),
  });

  useEffect(() => {
    if (settings && !initialValuesRef.current) {
      const map: SettingsMap = {};
      settings.forEach((s) => {
        map[s.key] = s.value;
      });
      initialValuesRef.current = map;
      setValues(map);
    }
  }, [settings]);

  const searchQuery = search.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!searchQuery || !settings) return null;
    return settings.filter(
      (s) =>
        s.label.toLowerCase().includes(searchQuery) ||
        s.description.toLowerCase().includes(searchQuery) ||
        s.key.toLowerCase().includes(searchQuery),
    );
  }, [searchQuery, settings]);

  const dirty = useMemo(() => {
    if (!settings || !initialValuesRef.current) return false;
    return settings.some((s) => initialValuesRef.current![s.key] !== values[s.key]);
  }, [settings, values]);

  const dirtyCount = useMemo(() => {
    if (!settings || !initialValuesRef.current) return 0;
    return settings.filter((s) => initialValuesRef.current![s.key] !== values[s.key]).length;
  }, [settings, values]);

  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (blocker.state === "blocked") setConfirmLeave(true);
  }, [blocker.state]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    const baseTitle = "Settings | VigiLens";
    document.title = dirty ? `\u25CF ${dirtyCount} unsaved \u2013 ${baseTitle}` : baseTitle;
    return () => {
      document.title = baseTitle;
    };
  }, [dirty, dirtyCount]);

  function setValue(key: string, value: SettingsValue) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function isCategoryDirty(category: SettingsCategory): boolean {
    if (!settings || !initialValuesRef.current) return false;
    return settings.some(
      (s) => s.category === category && initialValuesRef.current![s.key] !== values[s.key],
    );
  }

  function changesForCategory(category: SettingsCategory): SettingsUpdateInput {
    const changes: SettingsUpdateInput = {};
    if (!settings || !initialValuesRef.current) return changes;
    settings
      .filter((s) => s.category === category)
      .forEach((s) => {
        if (initialValuesRef.current![s.key] !== values[s.key]) {
          changes[s.key] = values[s.key];
        }
      });
    return changes;
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const categories = CATEGORY_KEYS.filter(
        (cat) => Object.keys(changesForCategory(cat)).length > 0,
      );
      for (const cat of categories) {
        await settingsService.update(cat, changesForCategory(cat));
      }
      return categories;
    },
    onSuccess: (categories) => {
      initialValuesRef.current = { ...values };
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      showToast({
        severity: "info",
        title: "Settings saved",
        message:
          categories.length === 0
            ? "No changes to save"
            : `Updated ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`,
      });
    },
    onError: (err) => {
      showToast({
        severity: "critical",
        title: "Failed to save settings",
        message: getApiErrorMessage(err),
      });
    },
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!dirty || saveMutation.isPending) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        saveMutation.mutate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, saveMutation]);

  const resetMutation = useMutation({
    mutationFn: (category: SettingsCategory) => settingsService.reset(category),
    onSuccess: (updated, category) => {
      setValues((prev) => {
        const next = { ...prev };
        updated.forEach((s) => {
          next[s.key] = s.value;
        });
        return next;
      });
      if (initialValuesRef.current) {
        updated.forEach((s) => {
          initialValuesRef.current![s.key] = s.value;
        });
      }
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      showToast({
        severity: "info",
        title: "Settings reset",
        message: `${CATEGORY_META[category].label} settings restored to defaults`,
      });
    },
    onError: (err) => {
      showToast({
        severity: "critical",
        title: "Failed to reset settings",
        message: getApiErrorMessage(err),
      });
    },
  });

  const renderFields = (rows: SystemSetting[]) =>
    rows.map((setting) => {
      const isModified =
        initialValuesRef.current !== null &&
        initialValuesRef.current[setting.key] !== values[setting.key];
      return (
        <div
          key={`${setting.category}:${setting.key}`}
          className={`border-b border-gray-100 last:border-0 py-4 transition-colors ${
            isModified ? "bg-amber-50/50" : ""
          }`}
        >
          <SettingField
            setting={setting}
            value={values[setting.key] ?? setting.value}
            onChange={(value) => setValue(setting.key, value)}
            modified={isModified}
          />
        </div>
      );
    });

  const activeMeta = CATEGORY_META[activeCategory];
  const ActiveIcon = activeMeta.icon;
  const isSearching = Boolean(searchQuery);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <SlidersHorizontal className="w-6 h-6 text-brand-600" />
            System Settings
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure application behavior, security and monitoring preferences
          </p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search settings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <aside className="lg:w-64 flex-shrink-0">
          <nav className="card p-2 space-y-1" aria-label="Settings categories">
            {CATEGORY_KEYS.map((category) => {
              const meta = CATEGORY_META[category];
              const Icon = meta.icon;
              const active = activeCategory === category && !isSearching;
              const categoryDirty = isCategoryDirty(category);
              return (
                <button
                  key={category}
                  onClick={() => {
                    setActiveCategory(category);
                    setSearch("");
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? "bg-brand-600 text-white"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left">{meta.label}</span>
                  {categoryDirty && (
                    <span
                      className="w-2 h-2 rounded-full bg-amber-500"
                      title="Unsaved changes"
                    />
                  )}
                </button>
              );
            })}
          </nav>
          {!isSearching && (
            <p className="text-xs text-gray-400 px-2 mt-3">
              {activeMeta.description}
            </p>
          )}
        </aside>

        <div className="flex-1 min-w-0">
          <div className="card">
            {isLoading ? (
              <div className="space-y-4">
                <SkeletonField />
                <SkeletonField />
                <SkeletonField />
              </div>
            ) : isError ? (
              <div className="text-center py-12">
                <AlertTriangle className="w-12 h-12 text-red-300 mx-auto mb-3" />
                <p className="text-gray-700 font-medium">Failed to load settings</p>
                <p className="text-gray-400 text-sm mt-1">
                  Check your connection and try again
                </p>
                <button
                  onClick={() => refetch()}
                  className="btn-primary mt-4 inline-flex items-center gap-2"
                >
                  <Loader2 className="w-4 h-4" />
                  Retry
                </button>
              </div>
            ) : isSearching ? (
              searchResults && searchResults.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {CATEGORY_KEYS.map((category) => {
                    const matches = searchResults!.filter((s) => s.category === category);
                    if (matches.length === 0) return null;
                    return (
                      <div key={category} className="py-1">
                        <div className="flex items-center gap-2 py-3">
                          {(() => {
                            const Icon = CATEGORY_META[category].icon;
                            return <Icon className="w-4 h-4 text-brand-600" />;
                          })()}
                          <h3 className="text-sm font-semibold text-gray-700">
                            {CATEGORY_META[category].label}
                          </h3>
                          <span className="text-xs text-gray-400">
                            {matches.length} match{matches.length === 1 ? "" : "es"}
                          </span>
                        </div>
                        <div className="border-t border-gray-100">
                          {renderFields(matches)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No settings found</p>
                  <p className="text-gray-400 text-sm mt-1">
                    Try a different search term
                  </p>
                </div>
              )
            ) : (
              <div>
                <div className="flex items-center gap-2 pb-4 border-b border-gray-100">
                  <ActiveIcon className="w-5 h-5 text-brand-600" />
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      {activeMeta.label}
                    </h2>
                    <p className="text-xs text-gray-500">{activeMeta.description}</p>
                  </div>
                </div>
                <div>
                  {renderFields(
                    settings?.filter((s) => s.category === activeCategory) ?? [],
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sticky bottom-4">
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            {dirty ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-gray-600 font-medium">
                  {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
                </span>
              </>
            ) : (
              <span className="text-gray-400">All changes saved</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => resetMutation.mutate(activeCategory)}
              disabled={isSearching || resetMutation.isPending}
              className="btn-secondary inline-flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resetMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Reset {activeMeta.label}
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
              className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => {
              blocker.reset?.();
              setConfirmLeave(false);
            }}
          />
          <div className="relative z-10 card w-full max-w-md space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Unsaved changes</h3>
                <p className="text-sm text-gray-500 mt-1">
                  You have unsaved settings changes. Leaving this page will discard
                  them.
                </p>
              </div>
              <button
                onClick={() => {
                  blocker.reset?.();
                  setConfirmLeave(false);
                }}
                className="ml-auto p-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  blocker.reset?.();
                  setConfirmLeave(false);
                }}
                className="btn-secondary text-sm"
              >
                Keep editing
              </button>
              <button onClick={() => blocker.proceed?.()} className="btn-primary text-sm">
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
