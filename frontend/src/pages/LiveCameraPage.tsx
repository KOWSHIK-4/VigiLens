import { useRef, useState, useEffect, useCallback } from "react";
import { engineService } from "@/services/engine";
import { cameraService } from "@/services/cameras";
import type { EngineStoredDetection } from "@/types";

interface WebcamStats {
  fps: number;
  persons: number;
  confidence: number;
  total_persons: number;
  image_width: number;
  image_height: number;
}

const AI_STREAM_URL = "/detect/webcam";
const AI_STATS_URL = "/detect/webcam/stats";
const POLL_INTERVAL = 1000;
const DETECTOR_KEY = "person";

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

export default function LiveCameraPage() {
  const imgRef = useRef<HTMLImageElement>(null);
  const [active, setActive] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<WebcamStats | null>(null);
  const [detections, setDetections] = useState<EngineStoredDetection[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string>("default");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshFeed = useCallback(async () => {
    try {
      setLoadingFeed(true);
      const data = await engineService.getDetections(DETECTOR_KEY, 20);
      setDetections(data.detections);
    } catch {
      /* feed poll silently fails while stream is warming up */
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    cameraService
      .getAll({ page: 1, limit: 100 })
      .then((res) => {
        if (!cancelled && res.data.length > 0) {
          setCameraId(res.data[0].id);
        }
      })
      .catch(() => {
        /* fall back to default camera id */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startStream = useCallback(() => {
    setError(null);
    setStreamUrl(`${AI_STREAM_URL}?camera_id=${encodeURIComponent(cameraId)}&t=${Date.now()}`);
    setActive(true);
    void refreshFeed();
  }, [cameraId, refreshFeed]);

  const stopStream = useCallback(() => {
    setStreamUrl(null);
    setActive(false);
    setStats(null);
    setDetections([]);
  }, []);

  useEffect(() => {
    if (active) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(AI_STATS_URL);
          if (res.ok) {
            const data: WebcamStats = await res.json();
            setStats(data);
          }
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
  }, [active, refreshFeed]);

  const handleImgError = useCallback(() => {
    setError("Failed to connect to camera stream. Make sure the AI service is running.");
    stopStream();
  }, [stopStream]);

  const overlayBoxes = detections
    .filter((d) => d.boundingBox)
    .map((d) => {
      const frameW = stats?.image_width || d.boundingBox!.x2;
      const frameH = stats?.image_height || d.boundingBox!.y2;
      return { detection: d, frameW, frameH };
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Live Camera</h2>
          <p className="text-gray-500 mt-1">
            Real-time person detection stream backed by engine data
          </p>
        </div>
        <div className="flex gap-3">
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
        </div>

        <div className="space-y-4">
          <div className="card">
            <p className="text-sm font-medium text-gray-500">FPS</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {stats?.fps ?? "--"}
            </p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-500">Persons Detected</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {stats?.persons ?? "--"}
            </p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-500">Total Persons</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {stats?.total_persons ?? "--"}
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
