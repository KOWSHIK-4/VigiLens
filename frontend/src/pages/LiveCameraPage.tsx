import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { engineService } from "@/services/engine";
import { cameraService } from "@/services/cameras";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/utils/permissions";
import type {
  Camera,
  EngineDetector,
  EngineLiveProcessResponse,
  EngineStoredDetection,
} from "@/types";

interface WebcamStats {
  fps: number;
  objects: number;
  total_objects: number;
  persons?: number;
  total_persons?: number;
  confidence: number;
  image_width: number;
  image_height: number;
}

type StreamState = "stopped" | "starting" | "streaming" | "reconnecting" | "error";

const AI_STREAM_URL = "/detect/webcam";
const AI_STATS_URL = "/detect/webcam/stats";
const POLL_INTERVAL = 1000;
const MAX_STATS_FAILURES = 3;
const MAX_FEED_FAILURES = 3;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_EVERY_MS = 3000;

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

function formatConfidence(conf: number) {
  return `${(conf * 100).toFixed(0)}%`;
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "online":
      return "bg-green-100 text-green-800 border-green-200";
    case "connecting":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "error":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

const STREAM_STATE_META: Record<
  StreamState,
  { label: string; className: string }
> = {
  stopped: { label: "Stopped", className: "bg-gray-100 text-gray-600 border-gray-200" },
  starting: { label: "Connecting", className: "bg-amber-100 text-amber-800 border-amber-200" },
  streaming: { label: "Streaming", className: "bg-green-100 text-green-800 border-green-200" },
  reconnecting: { label: "Reconnecting", className: "bg-amber-100 text-amber-800 border-amber-200" },
  error: { label: "Error", className: "bg-red-100 text-red-800 border-red-200" },
};

export default function LiveCameraPage() {
  const imgRef = useRef<HTMLImageElement>(null);
  const { user } = useAuth();
  const canRunInference = hasPermission(user, "models.run");
  const [active, setActive] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("stopped");
  const [streamEpoch, setStreamEpoch] = useState<number | null>(null);
  const [stats, setStats] = useState<WebcamStats | null>(null);
  const [detections, setDetections] = useState<EngineStoredDetection[]>([]);
  const [detectors, setDetectors] = useState<EngineDetector[]>([]);
  const [detectorKey, setDetectorKey] = useState<string>("person");
  const [liveResult, setLiveResult] = useState<EngineLiveProcessResponse | null>(null);
  const [processingLive, setProcessingLive] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [feedUnavailable, setFeedUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string>("default");
  const [cameras, setCameras] = useState<Camera[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsFailuresRef = useRef(0);
  const feedFailuresRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const streamStateRef = useRef<StreamState>("stopped");

  const selectedCamera = cameras.find((c) => c.id === cameraId) ?? null;

  const updateStreamState = useCallback((next: StreamState) => {
    streamStateRef.current = next;
    setStreamState(next);
  }, []);

  const streamUrl = useMemo(() => {
    if (!active || streamEpoch == null) return null;
    return `${AI_STREAM_URL}?camera_id=${encodeURIComponent(cameraId)}&detector=${encodeURIComponent(detectorKey)}&t=${streamEpoch}`;
  }, [active, cameraId, detectorKey, streamEpoch]);

  const refreshFeed = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setManualRefreshing(true);
    try {
      const data = await engineService.getDetections(detectorKey, 20);
      setDetections(data.detections);
      feedFailuresRef.current = 0;
      setFeedUnavailable(false);
    } catch {
      feedFailuresRef.current += 1;
      if (feedFailuresRef.current >= MAX_FEED_FAILURES) {
        setFeedUnavailable(true);
      }
    } finally {
      if (!silent) setManualRefreshing(false);
    }
  }, [detectorKey]);

  const startStream = useCallback(() => {
    setError(null);
    setStats(null);
    statsFailuresRef.current = 0;
    feedFailuresRef.current = 0;
    reconnectAttemptsRef.current = 0;
    setFeedUnavailable(false);
    setManualRefreshing(false);
    setStreamEpoch(Date.now());
    updateStreamState("starting");
    setActive(true);
    void refreshFeed({ silent: true });
  }, [updateStreamState, refreshFeed]);

  const stopStream = useCallback(() => {
    statsFailuresRef.current = 0;
    feedFailuresRef.current = 0;
    reconnectAttemptsRef.current = 0;
    setStreamEpoch(null);
    setActive(false);
    setStats(null);
    setDetections([]);
    setLiveResult(null);
    setFeedUnavailable(false);
    updateStreamState("stopped");
  }, [updateStreamState]);

  const recordStatsFailure = useCallback(
    (emptyPayload = false) => {
      if (emptyPayload) {
        // An empty payload while the stream is warming up is normal; it is
        // only meaningful once we had a live stream and it went stale.
        if (streamStateRef.current !== "streaming") return;
        statsFailuresRef.current += 1;
      } else {
        statsFailuresRef.current += 1;
      }
      if (statsFailuresRef.current >= MAX_STATS_FAILURES) {
        if (streamStateRef.current !== "reconnecting") {
          reconnectAttemptsRef.current = 0;
          updateStreamState("reconnecting");
        }
      }
    },
    [updateStreamState],
  );

  const resetStreamHealth = useCallback(() => {
    statsFailuresRef.current = 0;
    reconnectAttemptsRef.current = 0;
    updateStreamState("streaming");
  }, [updateStreamState]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      engineService.getAll(),
      cameraService.getAll({ page: 1, limit: 100 }),
    ])
      .then(([engines, camRes]) => {
        if (cancelled) return;
        const runnable = engines.filter((e) => e.availability === "available");
        const available = runnable.length > 0 ? runnable : engines;
        setDetectors(available);
        if (available.length > 0) {
          setDetectorKey(available[0].key);
        }
        setCameras(camRes.data);
        if (camRes.data.length > 0) {
          setCameraId(camRes.data[0].id);
        }
      })
      .catch((err) => {
        console.warn("Failed to load engine/camera data:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      if (pollRef.current) clearInterval(pollRef.current);
      if (feedRef.current) clearInterval(feedRef.current);
      pollRef.current = null;
      feedRef.current = null;
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      camera_id: cameraId,
      detector: detectorKey,
    });

    pollRef.current = setInterval(async () => {
      try {
        // The stats endpoint lives on the AI service (/detect/* is proxied
        // to it by the dev server and nginx) — NOT under the backend /api.
        const res = await fetch(`${AI_STATS_URL}?${params.toString()}`);
        if (cancelled) return;
        if (!res.ok) {
          recordStatsFailure();
          return;
        }
        const data = (await res.json()) as WebcamStats;
        if (cancelled) return;
        const hasLiveStats =
          data && typeof data === "object" && Object.keys(data).length > 0;
        if (hasLiveStats) {
          // If the stream had dropped, reattach the <img> to the fresh stream
          // so the viewport resumes rendering instead of staying frozen.
          if (streamStateRef.current === "reconnecting") {
            setStreamEpoch(Date.now());
          }
          setStats(data);
          resetStreamHealth();
        } else {
          recordStatsFailure(true);
        }
      } catch {
        if (!cancelled) recordStatsFailure();
      }
    }, POLL_INTERVAL);

    feedRef.current = setInterval(() => {
      void refreshFeed({ silent: true });
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (feedRef.current) {
        clearInterval(feedRef.current);
        feedRef.current = null;
      }
    };
  }, [active, cameraId, detectorKey, refreshFeed, recordStatsFailure, resetStreamHealth]);

  // Bounded auto-reconnect: while the stream reports connection trouble,
  // re-request the MJPEG stream after a short delay so transient AI-service
  // blips recover on their own. A reattach is capped so a permanently dead
  // stream cannot trigger an endless refresh loop; the user can also
  // reconnect manually from the video overlay.
  useEffect(() => {
    if (!active || streamState !== "reconnecting") return;
    const timer = setTimeout(() => {
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        setStreamEpoch(Date.now());
      }
    }, RECONNECT_EVERY_MS);
    return () => clearTimeout(timer);
  }, [active, streamState, streamEpoch]);

  const handleImgError = useCallback(() => {
    if (!active) return;
    // A failed reattach during auto-reconnect is expected; keep retrying.
    if (streamStateRef.current === "reconnecting") return;
    updateStreamState("error");
    stopStream();
    setError("Failed to connect to camera stream. Make sure the AI service is running.");
  }, [active, updateStreamState, stopStream]);

  const handleReconnect = useCallback(() => {
    setError(null);
    reconnectAttemptsRef.current = 0;
    setManualRefreshing(false);
    setStreamEpoch(Date.now());
  }, []);

  const handleProcessLive = useCallback(async () => {
    if (!selectedCamera || processingLive) return;
    setProcessingLive(true);
    setError(null);
    try {
      const result = await engineService.processLive(detectorKey, selectedCamera.id);
      setLiveResult(result);
      void refreshFeed();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Live processing failed";
      setError(`Live inference failed: ${message}`);
    } finally {
      setProcessingLive(false);
    }
  }, [selectedCamera, detectorKey, processingLive, refreshFeed]);

  const overlayBoxes = detections
    .filter((d) => d.boundingBox)
    .map((d) => {
      const frameW = stats?.image_width || (d.boundingBox!.x2 > 0 ? d.boundingBox!.x2 : 640);
      const frameH = stats?.image_height || (d.boundingBox!.y2 > 0 ? d.boundingBox!.y2 : 480);
      return { detection: d, frameW, frameH };
    });

  const objectCount = stats?.objects ?? stats?.persons ?? 0;
  const totalObjectCount = stats?.total_objects ?? stats?.total_persons ?? 0;
  const streamMeta = STREAM_STATE_META[streamState];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Live Camera</h2>
          <p className="text-gray-500 mt-1">
            Real-time detection stream backed by engine data
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {detectors.length > 0 && (
            <select
              value={detectorKey}
              onChange={(e) => setDetectorKey(e.target.value)}
              disabled={active}
              className="input min-w-[160px] text-sm"
              aria-label="Select detector"
            >
              {detectors.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name} ({d.key})
                </option>
              ))}
            </select>
          )}
          {cameras.length > 0 && (
            <select
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              disabled={active}
              className="input min-w-[180px] text-sm"
              aria-label="Select camera"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.location ? ` (${c.location})` : ""}
                </option>
              ))}
            </select>
          )}
          {!active ? (
            <button onClick={startStream} className="btn-primary">
              Start Camera
            </button>
          ) : (
            <button onClick={stopStream} className="btn-secondary">
              Stop Camera
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <div className="card !p-0 overflow-hidden bg-black relative">
            {active && streamUrl ? (
              <>
                <img
                  ref={imgRef}
                  src={streamUrl}
                  alt="Live webcam stream"
                  className="w-full h-auto"
                  onError={handleImgError}
                />
                {streamState === "starting" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-sm font-medium border border-amber-200">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      Connecting to camera stream…
                    </span>
                  </div>
                )}
                {streamState === "streaming" && (
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500 text-white text-xs font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    LIVE
                  </span>
                )}
                {streamState === "reconnecting" && (
                  <div className="absolute inset-x-0 bottom-0 bg-amber-500/90 text-white text-xs font-medium text-center px-3 py-1.5">
                    Connection lost — reconnecting
                    {reconnectAttemptsRef.current > 0
                      ? ` (attempt ${reconnectAttemptsRef.current})`
                      : ""}
                    …
                  </div>
                )}
                {overlayBoxes.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none">
                    {overlayBoxes.map(({ detection: d, frameW, frameH }) => {
                      const box = d.boundingBox!;
                      const left = (box.x1 / frameW) * 100;
                      const top = (box.y1 / frameH) * 100;
                      const width = ((box.x2 - box.x1) / frameW) * 100;
                      const height = ((box.y2 - box.y1) / frameH) * 100;
                      return (
                        <div
                          key={d.id}
                          className="absolute border-2 border-green-500"
                          style={{
                            left: `${left}%`,
                            top: `${top}%`,
                            width: `${width}%`,
                            height: `${height}%`,
                          }}
                        >
                          <span className="absolute -top-5 left-0 bg-green-500 text-white text-[10px] font-medium px-1 py-0.5 whitespace-nowrap rounded">
                            {d.className || d.label} {formatConfidence(d.confidence)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-[480px] text-gray-500">
                <div className="text-center">
                  <p className="text-lg mb-2">Camera is stopped</p>
                  <p className="text-sm">Click "Start Camera" to begin</p>
                </div>
              </div>
            )}
          </div>

          {selectedCamera && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusBadgeClass(selectedCamera.status)}`}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    selectedCamera.status === "online"
                      ? "bg-green-500"
                      : selectedCamera.status === "connecting"
                        ? "bg-amber-500"
                        : selectedCamera.status === "error"
                          ? "bg-red-500"
                          : "bg-gray-400"
                  }`}
                />
                {selectedCamera.status}
              </span>
              <span className="text-sm text-gray-500">
                {selectedCamera.name}
                {selectedCamera.cameraType ? ` · ${selectedCamera.cameraType}` : ""}
              </span>
              <span className="text-sm text-gray-500">
                Detector: <span className="font-medium text-gray-700">{detectorKey}</span>
              </span>
              {active && (
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${streamMeta.className}`}
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      streamState === "streaming"
                        ? "bg-green-500"
                        : streamState === "starting" || streamState === "reconnecting"
                          ? "bg-amber-500"
                          : "bg-gray-400"
                    }`}
                  />
                  Stream: {streamMeta.label}
                </span>
              )}
              {active && streamState === "reconnecting" && (
                <button onClick={handleReconnect} className="btn-secondary text-xs">
                  Reconnect now
                </button>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card">
            <p className="text-sm font-medium text-gray-500">FPS</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {stats?.fps ?? "--"}
            </p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-500">Objects Detected</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {objectCount || "--"}
            </p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-500">Total Objects</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {totalObjectCount || "--"}
            </p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-500">Confidence</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {stats?.confidence != null
                ? formatConfidence(stats.confidence)
                : "--"}
            </p>
          </div>
          <div className="card">
            <button
              onClick={() => void handleProcessLive()}
              disabled={processingLive || !selectedCamera || !canRunInference}
              title={canRunInference ? undefined : "Requires the Run AI Models permission"}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processingLive ? "Processing..." : "Process Live Frame"}
            </button>
            <p className="text-sm text-gray-500 mt-3">
              {canRunInference
                ? "Capture one fresh frame from the selected camera and run inference now."
                : "You need the Run AI Models permission to trigger on-demand inference."}
            </p>
            {liveResult && (
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Detections</dt>
                  <dd className="font-medium text-gray-900">{liveResult.count}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Latency</dt>
                  <dd className="font-medium text-gray-900">
                    {liveResult.latencyMs != null
                      ? `${liveResult.latencyMs.toFixed(1)} ms`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Processed</dt>
                  <dd className="font-medium text-gray-900">
                    {formatTime(liveResult.processedAt)}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Live Detection Feed
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Real engine detections persisted by the backend
            </p>
            {feedUnavailable && (
              <p className="text-xs text-amber-600 mt-1">
                Feed temporarily unavailable — retrying automatically. Showing
                the last known detections.
              </p>
            )}
          </div>
          <button
            onClick={() => void refreshFeed()}
            className="btn-secondary text-sm"
            disabled={manualRefreshing}
          >
            {manualRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {detections.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            No engine detections recorded yet. Detections appear here as the
            camera streams and the engine persists them.
          </p>
        ) : (
          <div className={`overflow-x-auto ${feedUnavailable ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4 font-medium">Class</th>
                  <th className="py-2 pr-4 font-medium">Confidence</th>
                  <th className="py-2 pr-4 font-medium">Track ID</th>
                  <th className="py-2 pr-4 font-medium">Detector</th>
                  <th className="py-2 pr-4 font-medium">Camera</th>
                  <th className="py-2 pr-4 font-medium">Inference</th>
                  <th className="py-2 font-medium">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {detections.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="py-2 pr-4">
                      <span className="inline-flex px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-medium border border-green-200">
                        {d.className || d.label}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-medium text-gray-900">
                      {formatConfidence(d.confidence)}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">
                      <code className="text-xs">{d.trackId ?? "—"}</code>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">
                      {d.detectorKey ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">
                      {d.cameraId}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">
                      {d.processingTimeMs != null
                        ? `${d.processingTimeMs.toFixed(1)} ms`
                        : "—"}
                    </td>
                    <td className="py-2 text-gray-500">{formatTime(d.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
    </div>
  );
}