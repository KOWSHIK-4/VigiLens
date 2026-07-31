import { registerDefaultDetectors } from "./defaults";

export { registerDetector, getDetectorDefinitions, getDetectorDefinition } from "./registry";
export type { DetectorDefinition } from "./registry";

registerDefaultDetectors();
