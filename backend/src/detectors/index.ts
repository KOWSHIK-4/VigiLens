import { registerDefaultDetectors } from "./defaults";

export {
  registerDetector,
  getDetectorDefinitions,
  getDetectorDefinition,
  getDetectorCategories,
  hasDetector,
} from "./registry";
export type { DetectorDefinition } from "./registry";

registerDefaultDetectors();
