import { useRef, useState, useEffect, useCallback } from "react";

interface WebcamStats {
  fps: number;
  persons: number;
  confidence: number;
  total_persons: number;
}

const AI_STREAM_URL = "/detect/webcam";
const AI_STATS_URL = "/detect/webcam/stats";
const POLL_INTERVAL = 500;

export default function LiveCameraPage() {
  const imgRef = useRef<HTMLImageElement>(null);
  const [active, setActive] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<WebcamStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startStream = useCallback(() => {
    setError(null);
    setStreamUrl(`${AI_STREAM_URL}?t=${Date.now()}`);
    setActive(true);
  }, []);

  const stopStream = useCallback(() => {
    setStreamUrl(null);
    setActive(false);
    setStats(null);
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
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [active]);

  const handleImgError = useCallback(() => {
    setError("Failed to connect to camera stream. Make sure the AI service is running.");
    stopStream();
  }, [stopStream]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Live Camera</h2>
          <p className="text-gray-500 mt-1">Real-time person detection stream</p>
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
          <div className="card !p-0 overflow-hidden bg-black">
            {streamUrl ? (
              <img
                ref={imgRef}
                src={streamUrl}
                alt="Live webcam stream"
                className="w-full h-auto"
                onError={handleImgError}
              />
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
                ? `${(stats.confidence * 100).toFixed(1)}%`
                : "--"}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
    </div>
  );
}
