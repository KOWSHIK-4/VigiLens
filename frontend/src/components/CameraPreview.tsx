import { useEffect, useState } from "react";
import type { Camera } from "@/types";
import { cameraService } from "@/services/cameras";
import { Monitor, Video, Webcam, FileVideo, Wifi, WifiOff } from "lucide-react";

const typeIcons = {
  usb: Webcam,
  rtsp: Monitor,
  ip: Video,
  video_file: FileVideo,
};

interface CameraPreviewProps {
  camera: Camera;
}

export function CameraPreview({ camera }: CameraPreviewProps) {
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const Icon = typeIcons[camera.cameraType] || Monitor;
  const isLive = camera.status === "online";
  const isConnecting = camera.status === "connecting";

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    setImgError(false);
    setSnapshotUrl(null);

    if (camera.thumbnail) {
      cameraService
        .getThumbnail(camera.id)
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setSnapshotUrl(objectUrl);
        })
        .catch(() => {
          if (!cancelled) setImgError(true);
        });
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [camera.id, camera.thumbnail]);

  if (snapshotUrl && !imgError) {
    return (
      <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative">
        <img
          src={snapshotUrl}
          alt={camera.name}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
        {isLive && <LiveBadge />}
        <ResolutionBadge resolution={camera.resolution} />
      </div>
    );
  }

  if (isLive) {
    const streamUrl = camera.sourceURL || camera.url || "";
    const streamPreviewable = /^(https?:|blob:|data:)/i.test(streamUrl);
    if (imgError || !streamPreviewable) {
      return (
        <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative flex flex-col items-center justify-center gap-2">
          {streamPreviewable ? (
            <WifiOff className="w-10 h-10 text-gray-600" />
          ) : (
            <Monitor className="w-10 h-10 text-gray-600" />
          )}
          <span className="text-gray-500 text-xs">
            {streamPreviewable
              ? "Preview unavailable"
              : "RTSP stream not previewable in browser"}
          </span>
          <ResolutionBadge resolution={camera.resolution} />
        </div>
      );
    }
    return (
      <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative flex items-center justify-center">
        <img
          src={streamUrl}
          alt={camera.name}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
        <LiveBadge />
        <ResolutionBadge resolution={camera.resolution} />
      </div>
    );
  }

  return (
    <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative flex flex-col items-center justify-center gap-2">
      {isConnecting ? (
        <>
          <div className="relative">
            <Wifi className="w-10 h-10 text-yellow-500 animate-pulse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
          <span className="text-yellow-500 text-xs font-medium">Connecting...</span>
        </>
      ) : (
        <>
          <Icon className="w-10 h-10 text-gray-600" />
          <WifiOff className="w-4 h-4 text-gray-500" />
          <span className="text-gray-500 text-xs">Offline</span>
        </>
      )}
      <ResolutionBadge resolution={camera.resolution} />
    </div>
  );
}

function LiveBadge() {
  return (
    <span className="absolute top-2 left-2 flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-600/80 text-white">
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      LIVE
    </span>
  );
}

function ResolutionBadge({ resolution }: { resolution: string | null }) {
  if (!resolution) return null;
  return (
    <span className="absolute top-2 right-2 text-xs font-medium px-2 py-0.5 rounded-full bg-black/60 text-white">
      {resolution}
    </span>
  );
}
