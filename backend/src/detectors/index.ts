import { registerDefaultDetectors } from "./defaults";

export {
  registerDetector,
  getDetectorDefinitions,
  getDetectorDefinition,
  hasDetector,
} from "./registry";
export type { DetectorDefinition } from "./registry";

registerDefaultDetectors();
