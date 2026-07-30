import { useEffect } from "react";
import { X, Download } from "lucide-react";

interface DetectionImagePreviewProps {
  src: string;
  label: string;
  onClose: () => void;
}

export default function DetectionImagePreview({ src, label, onClose }: DetectionImagePreviewProps) {
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

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = src;
    a.download = `detection-${label.replace(/\s+/g, "-").toLowerCase()}.jpg`;
    a.target = "_blank";
    a.click();
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
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors"
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
        <img
          src={src}
          alt={label}
          className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain"
        />
        <p className="text-white/70 text-sm text-center mt-3">{label}</p>
      </div>
    </div>
  );
}