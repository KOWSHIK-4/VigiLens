import { ImageOff, Loader2 } from "lucide-react";
import { useAuthImageUrl } from "@/utils/detectionImage";

interface DetectionSnapshotProps {
  imageUrl: string | null | undefined;
  alt: string;
  className?: string;
  placeholderClassName?: string;
}

/**
 * Renders a detection image honestly: a clear placeholder instead of a
 * broken <img> when no snapshot was captured or it fails to load.
 */
export default function DetectionSnapshot({
  imageUrl,
  alt,
  className = "w-full h-full object-cover",
  placeholderClassName = "",
}: DetectionSnapshotProps) {
  const { url, status } = useAuthImageUrl(imageUrl);

  if (status === "ready" && url) {
    return <img src={url} alt={alt} className={className} />;
  }
  if (status === "loading") {
    return (
      <div
        className={`w-full h-full flex items-center justify-center bg-gray-100 ${placeholderClassName}`}
      >
        <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
      </div>
    );
  }
  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center gap-1 bg-gray-100 text-gray-400 ${placeholderClassName}`}
      title={status === "empty" ? "No snapshot was captured for this detection" : "Snapshot could not be loaded"}
    >
      <ImageOff className="w-4 h-4" />
      <span className="text-[10px] uppercase tracking-wide">
        {status === "empty" ? "No snapshot" : "Unavailable"}
      </span>
    </div>
  );
}
