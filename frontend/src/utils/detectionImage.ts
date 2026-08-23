import { useEffect, useState } from "react";
import api from "@/services/api";

const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

export type SnapshotStatus = "empty" | "loading" | "ready" | "error";

export interface AuthImageUrlState {
  url: string | null;
  status: SnapshotStatus;
}

/**
 * Resolves a detection image reference into something an <img> can load.
 * Relative paths point at authenticated API endpoints and are fetched as
 * blobs with the session token; absolute http(s), data: and blob: URLs are
 * used as-is because the browser can load them directly.
 */
export function useAuthImageUrl(imageUrl: string | null | undefined): AuthImageUrlState {
  const [state, setState] = useState<AuthImageUrlState>({ url: null, status: "loading" });

  useEffect(() => {
    if (!imageUrl) {
      setState({ url: null, status: "empty" });
      return;
    }
    if (ABSOLUTE_URL.test(imageUrl)) {
      setState({ url: imageUrl, status: "ready" });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, status: "loading" });

    api
      .get<Blob>(imageUrl, { responseType: "blob" })
      .then(({ data }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        setState({ url: objectUrl, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, status: "error" });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUrl]);

  return state;
}

/**
 * Downloads a detection image, going through the API client so
 * authenticated endpoints work; resolves false when no snapshot exists
 * and rejects when fetching fails.
 */
export async function downloadDetectionImage(
  imageUrl: string | null | undefined,
  label: string,
): Promise<boolean> {
  if (!imageUrl) return false;
  let href = imageUrl;
  let revoke = false;
  if (!ABSOLUTE_URL.test(imageUrl)) {
    const { data } = await api.get<Blob>(imageUrl, { responseType: "blob" });
    href = URL.createObjectURL(data);
    revoke = true;
  }
  try {
    const a = document.createElement("a");
    a.href = href;
    a.download = `detection-${label.replace(/\s+/g, "-").toLowerCase()}.jpg`;
    a.target = "_blank";
    a.click();
  } finally {
    if (revoke) URL.revokeObjectURL(href);
  }
  return true;
}
