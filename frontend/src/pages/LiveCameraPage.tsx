import { useRef, useState, useEffect, useCallback } from "react";
import { engineService } from "@/services/engine";
import { cameraService } from "@/services/cameras";
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

const AI_STREAM_URL = "/detect/webcam";
const AI_STATS_URL = "/detect/webcam/stats";
const POLL_INTERVAL = 1000;

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

export default function LiveCameraPage() {
  const imgRef = useRef<HTMLImageElement>(null);
  const [active, setActive] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<WebcamStats | null>(null);
  const [detections, setDetections] = useState<EngineStoredDetection[]>([]);
  const [detectors, setDetectors] = useState<EngineDetector[]>([]);
  const [detectorKey, setDetectorKey] = useState<string>("person");
  const [liveResult, setLiveResult] = useState<EngineLiveProcessResponse | null>(null);
  const [processingLive, setProcessingLive] = useState(false);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string>("default");
  const [cameras, setCameras] = useState<Camera[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedCamera = cameras.find((c) => c.id === cameraId) ?? null;

  const refreshFeed = useCallback(async () => {
    try {
      setLoadingFeed(true);
      const data = await engineService.getDetections(detectorKey, 20);
      setDetections(data.detections);
    } catch {
      /* feed poll silently fails while stream is warming up */
    } finally {
      setLoadingFeed(false);
    }
  }, [detectorKey]);

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

  const startStream = useCallback(() => {
    setError(null);
    setStreamUrl(
      `${AI_STREAM_URL}?camera_id=${encodeURIComponent(cameraId)}&detector=${encodeURIComponent(detectorKey)}&t=${Date.now()}`,
    );
    setActive(true);
    void refreshFeed();
  }, [cameraId, detectorKey, refreshFeed]);

  const stopStream = useCallback(() => {
    setStreamUrl(null);
    setActive(false);
    setStats(null);
    setDetections([]);
    setLiveResult(null);
  }, []);

  useEffect(() => {
    if (active) {
      pollRef.current = setInterval(async () => {
        try {
          // The stats endpoint lives on the AI service (/detect/* is proxied
          // to it by the dev server and nginx) — NOT under the backend /api.
          const params = new URLSearchParams({
            camera_id: cameraId,
            detector: detectorKey,
          });
          const res = await fetch(`${AI_STATS_URL}?${params.toString()}`);
          if (!res.ok) return;
          setStats((await res.json()) as WebcamStats);
        } catch {
          /* stats poll silently fails */
        }
      }, POLL_INTERVAL);

      feedRef.current = setInterval(() => {
        void refreshFeed();
      }, POLL_INTERVAL);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (feedRef.current) {
        clearInterval(feedRef.current);
        feedRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (feedRef.current) {
        clearInterval(feedRef.current);
        feedRef.current = null;
      }
    };
  }, [active, cameraId, detectorKey, refreshFeed]);

  const handleImgError = useCallback(() => {
    setError("Failed to connect to camera stream. Make sure the AI service is running.");
    stopStream();
  }, [stopStream]);

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
            {streamUrl ? (
              <>
                <img
                  ref={imgRef}
                  src={streamUrl}
                  alt="Live webcam stream"
                  className="w-full h-auto"
                  onError={handleImgError}
                />
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
              disabled={processingLive || !selectedCamera}
              className="btn-primary w-full"
            >
              {processingLive ? "Processing..." : "Process Live Frame"}
            </button>
            <p className="text-sm text-gray-500 mt-3">
              Capture one fresh frame from the selected camera and run
              inference now.
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
          </div>
          <button
            onClick={() => void refreshFeed()}
            className="btn-secondary text-sm"
            disabled={loadingFeed}
          >
            {loadingFeed ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {detections.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            No engine detections recorded yet. Detections appear here as the
            camera streams and the engine persists them.
          </p>
        ) : (
          <div className="overflow-x-auto">
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
