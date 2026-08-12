import type { DetectorRuntimeStatus } from "@/types";
import EngineStatusBadge from "./EngineStatusBadge";

export default function DetectorRuntimeStatusBadge({
  status,
}: {
  status: DetectorRuntimeStatus;
}) {
  return <EngineStatusBadge status={status} />;
}
