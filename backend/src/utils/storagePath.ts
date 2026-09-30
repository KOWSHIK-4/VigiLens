import path from "path";

/**
 * Whether a configured media root is safe to hand to the services that write
 * into it (snapshot capture, health probe) or use as a prune target.
 *
 * Root-like paths are rejected so a misconfigured `storage_base_path` can
 * never point those code paths at `/` (or a drive root on Windows). Lives in
 * its own module because both the settings validation and the prune tool
 * need it, and the prune tool already depends on the settings service.
 */
export function isSafeStorageBasePath(basePath: string | undefined): boolean {
  if (!basePath || !basePath.trim()) return false;
  const resolved = path.resolve(basePath);
  const parsed = path.parse(resolved);
  return parsed.root !== resolved && path.dirname(resolved) !== resolved;
}