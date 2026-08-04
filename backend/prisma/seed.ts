import { PrismaClient, type RoleValue } from "@prisma/client";
import bcrypt from "bcrypt";
import { defaultDetectorDefinitions } from "../src/detectors/defaults";

const prisma = new PrismaClient();

export const permissionDefinitions = [
  { key: "users.read", name: "View Users", description: "List and inspect user accounts", category: "users" },
  { key: "users.create", name: "Create Users", description: "Create new user accounts", category: "users" },
  { key: "users.update", name: "Edit Users", description: "Update user account details", category: "users" },
  { key: "users.delete", name: "Delete Users", description: "Remove user accounts", category: "users" },
  { key: "users.assign_role", name: "Assign Roles", description: "Change the role of a user", category: "users" },
  { key: "users.reset_password", name: "Reset Passwords", description: "Trigger password resets for users", category: "users" },
  { key: "users.toggle_status", name: "Enable/Disable Users", description: "Activate or deactivate user accounts", category: "users" },
  { key: "roles.read", name: "View Roles", description: "View roles and their permissions", category: "roles" },
  { key: "roles.manage", name: "Manage Roles", description: "Edit role permission sets", category: "roles" },
  { key: "cameras.read", name: "View Cameras", description: "View camera feeds and health", category: "cameras" },
  { key: "cameras.manage", name: "Manage Cameras", description: "Create, edit and delete cameras", category: "cameras" },
  { key: "cameras.control", name: "Start/Stop Cameras", description: "Start and stop camera streams", category: "cameras" },
  { key: "detections.read", name: "View Detections", description: "View detection events", category: "detections" },
  { key: "models.read", name: "View AI Models", description: "View AI model catalog", category: "models" },
  { key: "models.manage", name: "Manage AI Models", description: "Create, edit, load and test AI models", category: "models" },
  { key: "analytics.read", name: "View Analytics", description: "View analytics dashboards", category: "analytics" },
  { key: "reports.read", name: "View Reports", description: "View and download reports", category: "reports" },
  { key: "reports.manage", name: "Manage Reports", description: "Generate and delete reports", category: "reports" },
  { key: "alerts.read", name: "View Alerts", description: "View alert notifications", category: "alerts" },
  { key: "alerts.manage", name: "Manage Alerts", description: "Acknowledge, mark and delete alerts", category: "alerts" },
] as const;

export const rolePermissionMap: Record<RoleValue, string[]> = {
  super_admin: permissionDefinitions.map((p) => p.key),
  admin: [
    "users.read",
    "users.create",
    "users.update",
    "users.delete",
    "users.assign_role",
    "users.reset_password",
    "users.toggle_status",
    "roles.read",
    "cameras.read",
    "cameras.manage",
    "cameras.control",
    "models.read",
    "models.manage",
    "analytics.read",
    "reports.read",
    "reports.manage",
    "alerts.read",
  ],
  operator: [
    "cameras.read",
    "cameras.control",
    "detections.read",
    "alerts.read",
    "alerts.manage",
  ],
  viewer: [
    "cameras.read",
    "detections.read",
    "models.read",
    "analytics.read",
    "reports.read",
    "alerts.read",
  ],
};

export const roleDefinitions: Array<{ name: RoleValue;
  description: string;
  permissions: string[];
}> = [
  { name: "super_admin", description: "Full unrestricted access to every VigiLens resource", permissions: rolePermissionMap.super_admin },
  { name: "admin", description: "Manage users, cameras, AI models and view analytics & reports", permissions: rolePermissionMap.admin },
  { name: "operator", description: "Monitor cameras and detections, control streams and manage alerts", permissions: rolePermissionMap.operator },
  { name: "viewer", description: "Read-only access to monitoring data and reports", permissions: rolePermissionMap.viewer },
];

async function main() {
  const password = await bcrypt.hash("admin123", 12);

  const permissionIds = new Map<string, string>();
  for (const def of permissionDefinitions) {
    const permission = await prisma.permission.upsert({
      where: { key: def.key },
      update: { name: def.name, description: def.description, category: def.category },
      create: { key: def.key, name: def.name, description: def.description, category: def.category },
    });
    permissionIds.set(def.key, permission.id);
  }

  for (const def of roleDefinitions) {
    await prisma.role.upsert({
      where: { name: def.name },
      update: { description: def.description },
      create: { name: def.name, description: def.description, isSystem: true },
    });
    await prisma.rolePermission.deleteMany({ where: { role: def.name } });
    await prisma.rolePermission.createMany({
      data: def.permissions
        .map((key) => permissionIds.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ role: def.name, permissionId })),
    });
  }

  const admin = await prisma.user.upsert({
    where: { email: "admin@vigilens.io" },
    update: { role: "admin", status: "active" },
    create: {
      email: "admin@vigilens.io",
      password,
      name: "Admin User",
      role: "admin",
    },
  });

  const superAdmin = await prisma.user.upsert({
    where: { email: "super@vigilens.io" },
    update: { role: "super_admin", status: "active" },
    create: {
      email: "super@vigilens.io",
      password,
      name: "Super Admin",
      role: "super_admin",
    },
  });

  const operator = await prisma.user.upsert({
    where: { email: "operator@vigilens.io" },
    update: { role: "operator", status: "active" },
    create: {
      email: "operator@vigilens.io",
      password,
      name: "Operator User",
      role: "operator",
    },
  });

  const viewer = await prisma.user.upsert({
    where: { email: "viewer@vigilens.io" },
    update: { role: "viewer", status: "active" },
    create: {
      email: "viewer@vigilens.io",
      password,
      name: "Viewer User",
      role: "viewer",
    },
  });

  const disabled = await prisma.user.upsert({
    where: { email: "disabled@vigilens.io" },
    update: { role: "viewer", status: "disabled" },
    create: {
      email: "disabled@vigilens.io",
      password,
      name: "Disabled User",
      role: "viewer",
      status: "disabled",
    },
  });

  const entrance = await prisma.camera.upsert({
    where: { id: "demo-camera-1" },
    update: {},
    create: {
      id: "demo-camera-1",
      name: "Main Entrance",
      url: "rtsp://camera-stream",
      cameraType: "rtsp",
      location: "Building A, Floor 1",
      resolution: "1920x1080",
      fps: 30,
      isHealthy: true,
      status: "online",
      lastSeen: new Date(),
    },
  });

  const parking = await prisma.camera.upsert({
    where: { id: "demo-camera-2" },
    update: {},
    create: {
      id: "demo-camera-2",
      name: "Parking Lot",
      url: "rtsp://parking-cam",
      cameraType: "rtsp",
      location: "Building A, Ground Floor",
      resolution: "2560x1440",
      fps: 20,
      isHealthy: true,
      status: "online",
      lastSeen: new Date(),
    },
  });

  const lobby = await prisma.camera.upsert({
    where: { id: "demo-camera-3" },
    update: {},
    create: {
      id: "demo-camera-3",
      name: "Lobby USB",
      url: "/dev/video0",
      cameraType: "usb",
      location: "Building A, Lobby",
      resolution: "1280x720",
      fps: 30,
      isHealthy: false,
      status: "error",
    },
  });

  const warehouse = await prisma.camera.upsert({
    where: { id: "demo-camera-4" },
    update: {},
    create: {
      id: "demo-camera-4",
      name: "Warehouse IP",
      url: "http://192.168.1.100:8080/video",
      cameraType: "ip",
      location: "Warehouse B",
      resolution: "1920x1080",
      fps: 15,
      isHealthy: true,
      status: "connecting",
    },
  });

  const demoFile = await prisma.camera.upsert({
    where: { id: "demo-camera-5" },
    update: {},
    create: {
      id: "demo-camera-5",
      name: "Demo Recording",
      url: "/recordings/demo.mp4",
      cameraType: "video_file",
      location: "Local Storage",
      resolution: "1920x1080",
      fps: 24,
      isHealthy: true,
      status: "offline",
    },
  });

  for (let index = 0; index < defaultDetectorDefinitions.length; index += 1) {
    const model = defaultDetectorDefinitions[index];
    const isDefaultActive = index === 0;
    await prisma.aIModel.upsert({
      where: { detectorKey: model.key },
      update: {
        name: model.name,
        version: model.version,
        description: model.description,
        confidenceThreshold: model.defaultConfidenceThreshold,
        gpuSupported: model.gpuSupported,
        modelPath: model.modelPath,
        enabled: true,
        status: isDefaultActive ? "loaded" : "disabled",
      },
      create: {
        name: model.name,
        version: model.version,
        description: model.description,
        detectorKey: model.key,
        confidenceThreshold: model.defaultConfidenceThreshold,
        gpuSupported: model.gpuSupported,
        modelPath: model.modelPath,
        enabled: true,
        status: isDefaultActive ? "loaded" : "disabled",
      },
    });
  }

  const registeredKeys = defaultDetectorDefinitions.map((d) => d.key);
  const staleModels = await prisma.aIModel.findMany({
    where: { detectorKey: { notIn: registeredKeys } },
  });
  if (staleModels.length > 0) {
    await prisma.aIModel.deleteMany({
      where: { detectorKey: { notIn: registeredKeys } },
    });
  }

  console.log({ admin, superAdmin, operator, viewer, disabled });
  console.log(`Seeded ${defaultDetectorDefinitions.length} default AI models`);
  console.log(
    `Seeded ${permissionDefinitions.length} permissions across ${roleDefinitions.length} roles`,
  );
  if (staleModels.length > 0) {
    console.log(`Removed ${staleModels.length} stale AI models`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
