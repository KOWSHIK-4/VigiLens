import axios from "axios";

export function getApiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    return data?.error || err.message || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}
