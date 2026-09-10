/**
 * Media retention pruning CLI.
 *
 * Usage:
 *   npx tsx src/scripts/pruneMedia.ts [options]
 *
 * Options:
 *   --dry-run            report what would be deleted without deleting
 *   --base <path>        override storage_base_path (default: the setting)
 *   --image-days <n>     image/snapshot retention in days (default: setting)
 *   --video-days <n>     video/recording retention in days (default: setting)
 *   --max-gb <n>         soft disk quota in GB (default: setting)
 *   --help               show this usage message
 *
 * The tool only ever deletes files under <storage_base_path>/snapshots and
 * <storage_base_path>/recordings, plus expired detection rows (which cascade
 * to their alerts). It refuses to run when the storage root resolves to a
 * filesystem root.
 */

import { pruneMedia } from "../services/mediaPrune.service";

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "help") {
        out[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

const USAGE = `Media retention pruning tool

Usage:
  npx tsx src/scripts/pruneMedia.ts [options]

Options:
  --dry-run            report what would be deleted without deleting
  --base <path>        override storage_base_path (default: the setting)
  --image-days <n>     image/snapshot retention in days (default: the setting)
  --video-days <n>     video/recording retention in days (default: the setting)
  --max-gb <n>         soft disk quota in GB (default: the setting)
  --help               show this usage message
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const report = await pruneMedia({
    storageBasePath: typeof args.base === "string" ? args.base : undefined,
    imageRetentionDays:
      typeof args["image-days"] === "string" ? parseInt(args["image-days"], 10) : undefined,
    videoRetentionDays:
      typeof args["video-days"] === "string" ? parseInt(args["video-days"], 10) : undefined,
    maxStorageGb: typeof args["max-gb"] === "string" ? parseInt(args["max-gb"], 10) : undefined,
    dryRun: args["dry-run"] === true || args["dry-run"] === "true",
  });

  process.stdout.write(
    `${report.dryRun ? "[dry-run] " : ""}Pruned ${report.filesRemoved} media file(s), ` +
      `freed ${report.bytesFreed} byte(s); purged ${report.detectionsRemoved} detection(s) ` +
      `older than ${report.detectionsCutoff} under ${report.storageBasePath}\n`
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`pruneMedia: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});