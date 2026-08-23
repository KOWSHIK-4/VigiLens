import { useEffect } from "react";
import { X, Download, ImageOff } from "lucide-react";
import { useAuthImageUrl, downloadDetectionImage } from "@/utils/detectionImage";
import { showToast } from "@/utils/toast";

interface DetectionImagePreviewProps {
  src: string;
  label: string;
  onClose: () => void;
}

export default function DetectionImagePreview({ src, label, onClose }: DetectionImagePreviewProps) {
  const { url, status } = useAuthImageUrl(src);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const handleDownload = async () => {
    try {
      await downloadDetectionImage(src, label);
    } catch (err) {
      console.error("Failed to download snapshot:", err);
      showToast({
        severity: "critical",
        title: "Download failed",
        message: "Could not download the snapshot. Please try again.",
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl max-h-[90vh] mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-10 right-0 flex gap-2">
          <button
            onClick={handleDownload}
            disabled={status !== "ready"}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Download
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors"
          >
            <X className="w-4 h-4" />
            Close
          </button>
        </div>
        {status === "ready" && url ? (
          <img
            src={url}
            alt={label}
            className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain"
          />
        ) : (
          <div className="w-[480px] max-w-full aspect-video rounded-xl bg-gray-900 border border-white/10 flex flex-col items-center justify-center gap-2 text-white/50">
            <ImageOff className="w-8 h-8" />
            <p className="text-sm">
              {status === "loading"
                ? "Loading snapshot…"
                : status === "empty"
                  ? "No snapshot was captured for this detection"
                  : "Snapshot could not be loaded"}
            </p>
          </div>
        )}
        <p className="text-white/70 text-sm text-center mt-3">{label}</p>
      </div>
    </div>
  );
}
