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
    key: "fire",
    name: "Fire Detection",
    version: "1.0.0",
    description: "Detects fire and open flames in monitored areas.",
    defaultConfidenceThreshold: 45,
    gpuSupported: true,
    modelPath: "/models/fire/fire.pt",
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
    key: "face_mask",
    name: "Face Mask Detection",
    version: "1.0.0",
    description: "Detects persons without face masks in restricted zones.",
    defaultConfidenceThreshold: 55,
    gpuSupported: true,
    modelPath: "/models/face_mask/face_mask.pt",
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
    key: "intrusion",
    name: "Intrusion Detection",
    version: "1.0.0",
    description: "Detects unauthorized entry into restricted zones.",
    defaultConfidenceThreshold: 65,
    gpuSupported: true,
    modelPath: "/models/intrusion/intrusion.pt",
  },
  {
    key: "drowsiness",
    name: "Drowsiness Detection",
    version: "1.0.0",
    description: "Detects operator drowsiness and fatigue signs.",
    defaultConfidenceThreshold: 60,
    gpuSupported: true,
    modelPath: "/models/drowsiness/drowsiness.pt",
  },
];

export function registerDefaultDetectors(): void {
  defaultDetectorDefinitions.forEach(registerDetector);
}
