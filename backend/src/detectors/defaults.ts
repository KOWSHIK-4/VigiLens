import { registerDetector, type DetectorDefinition } from "./registry";

export const defaultDetectorDefinitions: DetectorDefinition[] = [
  {
    key: "person",
    name: "Person Detection",
    version: "1.0.0",
    description: "Detects persons in camera frames using YOLOv11.",
    defaultConfidenceThreshold: 50,
    gpuSupported: true,
    modelPath: "/models/person/yolo11n.pt",
  },
  {
    key: "smoking",
    name: "Smoking Detection",
    version: "1.0.0",
    description: "Detects smoking activity in restricted areas.",
    defaultConfidenceThreshold: 55,
    gpuSupported: true,
    modelPath: "/models/smoking/smoking.pt",
  },
  {
    key: "helmet",
    name: "Helmet Detection",
    version: "1.0.0",
    description: "Detects workers without protective helmets.",
    defaultConfidenceThreshold: 60,
    gpuSupported: true,
    modelPath: "/models/helmet/helmet.pt",
  },
  {
    key: "fire",
    name: "Fire Detection",
    version: "1.0.0",
    description: "Detects fire and open flames in monitored areas.",
    defaultConfidenceThreshold: 45,
    gpuSupported: true,
    modelPath: "/models/fire/fire.pt",
  },
  {
    key: "smoke",
    name: "Smoke Detection",
    version: "1.0.0",
    description: "Detects smoke plumes to catch early fire signs.",
    defaultConfidenceThreshold: 50,
    gpuSupported: true,
    modelPath: "/models/smoke/smoke.pt",
  },
  {
    key: "vehicle",
    name: "Vehicle Detection",
    version: "1.0.0",
    description: "Detects cars, trucks, and motorcycles in traffic zones.",
    defaultConfidenceThreshold: 50,
    gpuSupported: true,
    modelPath: "/models/vehicle/vehicle.pt",
  },
  {
    key: "crowd",
    name: "Crowd Detection",
    version: "1.0.0",
    description: "Detects abnormal crowd density and gatherings.",
    defaultConfidenceThreshold: 55,
    gpuSupported: true,
    modelPath: "/models/crowd/crowd.pt",
  },
  {
    key: "intrusion",
    name: "Intrusion Detection",
    version: "1.0.0",
    description: "Detects unauthorized entry into restricted zones.",
    defaultConfidenceThreshold: 65,
    gpuSupported: true,
    modelPath: "/models/intrusion/intrusion.pt",
  },
  {
    key: "abandoned_object",
    name: "Abandoned Object Detection",
    version: "1.0.0",
    description: "Detects objects left unattended for prolonged periods.",
    defaultConfidenceThreshold: 60,
    gpuSupported: true,
    modelPath: "/models/abandoned/abandoned.pt",
  },
];

export function registerDefaultDetectors(): void {
  defaultDetectorDefinitions.forEach(registerDetector);
}
