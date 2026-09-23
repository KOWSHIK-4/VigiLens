import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { defaultDetectorDefinitions } from "../src/detectors/defaults";

const prisma = new PrismaClient();

export const permissionDefinitions = [
  // Dashboard
  { key: "dashboard.view", name: "View Dashboard", description: "View the monitoring dashboard", category: "dashboard" },
  // Users
  { key: "users.read", name: "View Users", description: "List and inspect user accounts", category: "users" },
  { key: "users.create", name: "Create Users", description: "Create new user accounts", category: "users" },
  { key: "users.update", name: "Edit Users", description: "Update user account details", category: "users" },
  { key: "users.delete", name: "Delete Users", description: "Remove user accounts", category: "users" },
  { key: "users.manage", name: "Manage Users", description: "Full management of user accounts", category: "users" },
  { key: "users.assign_role", name: "Assign Roles", description: "Change the role of a user", category: "users" },
  { key: "users.reset_password", name: "Reset Passwords", description: "Trigger password resets for users", category: "users" },
  { key: "users.toggle_status", name: "Enable/Disable Users", description: "Activate or deactivate user accounts", category: "users" },
  { key: "users.lock", name: "Lock Users", description: "Lock user accounts after incidents", category: "users" },
  { key: "users.unlock", name: "Unlock Users", description: "Unlock previously locked user accounts", category: "users" },
  // Roles
  { key: "roles.read", name: "View Roles", description: "View roles and their permissions", category: "roles" },
  { key: "roles.manage", name: "Manage Roles", description: "Create, edit and delete roles and permission sets", category: "roles" },
  // Cameras
{ key: "cameras.read", name: "View Cameras", description: "View camera feeds and health", category: "cameras" },
{ key: "cameras.manage", name: "Manage Cameras", description: "Create, edit and delete cameras", category: "cameras" },
{ key: "cameras.control", name: "Start/Stop Cameras", description: "Start and stop camera streams", category: "cameras" },
{ key: "teams.read", name: "View Teams", description: "View teams and their members", category: "teams" },
{ key: "teams.manage", name: "Manage Teams", description: "Create, edit and delete teams and manage memberships", category: "teams" },
  // Detections
  { key: "detections.read", name: "View Detections", description: "View detection events", category: "detections" },
  { key: "detections.view", name: "Access Detections", description: "Access the detections feed", category: "detections" },
  { key: "detections.manage", name: "Manage Detections", description: "Delete and clean up detection events", category: "detections" },
  // AI Models
  { key: "models.read", name: "View AI Models", description: "View AI model catalog", category: "models" },
  { key: "models.manage", name: "Manage AI Models", description: "Create, edit, load and test AI models", category: "models" },
  { key: "models.run", name: "Run AI Models", description: "Trigger on-demand inference through the detector engine", category: "models" },
  // Analytics
  { key: "analytics.read", name: "View Analytics", description: "View analytics dashboards", category: "analytics" },
  // Reports
  { key: "reports.read", name: "View Reports", description: "View and download reports", category: "reports" },
  { key: "reports.manage", name: "Manage Reports", description: "Generate and delete reports", category: "reports" },
  { key: "reports.generate", name: "Generate Reports", description: "Generate on-demand reports", category: "reports" },
  // Alerts
  { key: "alerts.read", name: "View Alerts", description: "View alert notifications", category: "alerts" },
  { key: "alerts.manage", name: "Manage Alerts", description: "Acknowledge, mark and delete alerts", category: "alerts" },
  // Audit
  { key: "audit.read", name: "View Audit Logs", description: "View system audit logs and activity history", category: "audit" },
  { key: "audit.export", name: "Export Audit Logs", description: "Export audit logs to CSV format", category: "audit" },
  { key: "audit.view", name: "Access Audit Trail", description: "Access the audit trail module", category: "audit" },
  // Settings
  { key: "settings.read", name: "View Settings", description: "View system settings and configuration", category: "settings" },
  { key: "settings.manage", name: "Manage Settings", description: "Change system settings and configuration", category: "settings" },
  // Monitoring
  { key: "monitoring.read", name: "View System Monitoring", description: "View system health, status and performance metrics", category: "monitoring" },
  { key: "monitoring.manage", name: "Manage Monitoring", description: "Start and stop the continuous monitoring scheduler", category: "monitoring" },
  // Security
  { key: "security.read", name: "View Security Dashboard", description: "View the security operations dashboard and account posture", category: "security" },
] as const;

export type PermissionDefinitionKey = (typeof permissionDefinitions)[number]["key"];

export const rolePermissionMap: Record<string, string[]> = {
  super_admin: permissionDefinitions.map((p) => p.key),
  admin: [
    "dashboard.view",
    "users.read",
    "users.create",
    "users.update",
    "users.delete",
    "users.manage",
    "users.assign_role",
    "users.reset_password",
    "users.toggle_status",
    "users.lock",
    "users.unlock",
    "roles.read",
    "cameras.read",
    "cameras.manage",
    "cameras.control",
    "teams.read",
    "teams.manage",
    "detections.read",
    "detections.view",
    "detections.manage",
    "models.read",
    "models.manage",
    "models.run",
    "analytics.read",
    "reports.read",
    "reports.manage",
    "reports.generate",
    "alerts.read",
    "alerts.manage",
    "audit.read",
    "audit.export",
    "audit.view",
    "settings.read",
    "settings.manage",
    "monitoring.read",
    "monitoring.manage",
    "security.read",
  ],
  operator: [
    "dashboard.view",
    "cameras.read",
    "cameras.control",
    "teams.read",
    "detections.read",
    "detections.view",
    "models.read",
    "models.run",
    "alerts.read",
    "alerts.manage",
  ],
  viewer: [
    "dashboard.view",
    "cameras.read",
    "teams.read",
    "detections.read",
    "detections.view",
    "models.read",
    "analytics.read",
    "reports.read",
    "alerts.read",
  ],
};

export const roleDefinitions: Array<{
  name: string;
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

  const defaultOrg = await prisma.organization.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Default Organization",
      slug: "default",
      description: "",
    },
  });

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
    let role = await prisma.role.findFirst({
      where: { name: def.name, organizationId: null },
    });
    if (role) {
      role = await prisma.role.update({
        where: { id: role.id },
        data: { description: def.description },
      });
    } else {
      role = await prisma.role.create({
        data: { name: def.name, description: def.description, isSystem: true, organizationId: null },
      });
    }
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: def.permissions
        .map((key) => permissionIds.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
    });
  }

  const defaultTeam = await prisma.team.upsert({
    where: { organizationId_name: { organizationId: defaultOrg.id, name: "Default Team" } },
    update: {},
    create: {
      name: "Default Team",
      description: "Default team for inducted members",
      organizationId: defaultOrg.id,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@vigilens.io" },
    update: { role: "admin", status: "active", organizationId: defaultOrg.id, teamId: defaultTeam.id },
    create: {
      email: "admin@vigilens.io",
      password,
      name: "Admin User",
      role: "admin",
      organizationId: defaultOrg.id,
      teamId: defaultTeam.id,
    },
  });

  const superAdmin = await prisma.user.upsert({
    where: { email: "super@vigilens.io" },
    update: { role: "super_admin", status: "active", organizationId: defaultOrg.id, teamId: defaultTeam.id },
    create: {
      email: "super@vigilens.io",
      password,
      name: "Super Admin",
      role: "super_admin",
      organizationId: defaultOrg.id,
      teamId: defaultTeam.id,
    },
  });

  const operator = await prisma.user.upsert({
    where: { email: "operator@vigilens.io" },
    update: { role: "operator", status: "active", organizationId: defaultOrg.id, teamId: defaultTeam.id },
    create: {
      email: "operator@vigilens.io",
      password,
      name: "Operator User",
      role: "operator",
      organizationId: defaultOrg.id,
      teamId: defaultTeam.id,
    },
  });

  const viewer = await prisma.user.upsert({
    where: { email: "viewer@vigilens.io" },
    update: { role: "viewer", status: "active", organizationId: defaultOrg.id, teamId: defaultTeam.id },
    create: {
      email: "viewer@vigilens.io",
      password,
      name: "Viewer User",
      role: "viewer",
      organizationId: defaultOrg.id,
      teamId: defaultTeam.id,
    },
  });

  const disabled = await prisma.user.upsert({
    where: { email: "disabled@vigilens.io" },
    update: { role: "viewer", status: "disabled", organizationId: defaultOrg.id, teamId: defaultTeam.id },
    create: {
      email: "disabled@vigilens.io",
      password,
      name: "Disabled User",
      role: "viewer",
      status: "disabled",
      organizationId: defaultOrg.id,
      teamId: defaultTeam.id,
    },
  });

  const entrance = await prisma.camera.upsert({
    where: { id: "demo-camera-1" },
    update: { organizationId: defaultOrg.id },
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
      organizationId: defaultOrg.id,
    },
  });

  const parking = await prisma.camera.upsert({
    where: { id: "demo-camera-2" },
    update: { organizationId: defaultOrg.id },
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
      organizationId: defaultOrg.id,
    },
  });

  const lobby = await prisma.camera.upsert({
    where: { id: "demo-camera-3" },
    update: { organizationId: defaultOrg.id },
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
      organizationId: defaultOrg.id,
    },
  });

  const warehouse = await prisma.camera.upsert({
    where: { id: "demo-camera-4" },
    update: { organizationId: defaultOrg.id },
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
      organizationId: defaultOrg.id,
    },
  });

  const demoFile = await prisma.camera.upsert({
    where: { id: "demo-camera-5" },
    update: { organizationId: defaultOrg.id },
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
      organizationId: defaultOrg.id,
    },
  });

  for (let index = 0; index < defaultDetectorDefinitions.length; index += 1) {
    const model = defaultDetectorDefinitions[index];
    if (model.autoInstall === false) continue;
    const isDefaultActive = index === 0;
    const detector = await prisma.aIModel.upsert({
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
    await prisma.detectorSettings.upsert({
      where: { aiModelId: detector.id },
      update: {},
      create: { aiModelId: detector.id },
    });
  }

  const personModel = await prisma.aIModel.findUnique({ where: { detectorKey: "person" } });
  const vehicleModel = await prisma.aIModel.findUnique({ where: { detectorKey: "vehicle" } });
  const cameraAssignments = [
    { modelId: personModel?.id, cameraId: "demo-camera-1", enabled: true },
    { modelId: personModel?.id, cameraId: "demo-camera-2", enabled: true },
    { modelId: vehicleModel?.id, cameraId: "demo-camera-2", enabled: true },
  ];
  for (const assignment of cameraAssignments) {
    if (!assignment.modelId) continue;
    await prisma.detectorCamera.upsert({
      where: {
        aiModelId_cameraId: {
          aiModelId: assignment.modelId,
          cameraId: assignment.cameraId,
        },
      },
      update: { enabled: assignment.enabled },
      create: {
        aiModelId: assignment.modelId,
        cameraId: assignment.cameraId,
        enabled: assignment.enabled,
      },
    });
  }

  const registeredKeys = defaultDetectorDefinitions.map((d) => d.key);  const staleModels = await prisma.aIModel.findMany({
    where: { detectorKey: { notIn: registeredKeys } },
  });
  if (staleModels.length > 0) {
    await prisma.aIModel.deleteMany({
      where: { detectorKey: { notIn: registeredKeys } },
    });
  }

  console.log({ admin, superAdmin, operator, viewer, disabled });
  const seededModels = defaultDetectorDefinitions.filter(
    (d) => d.autoInstall !== false,
  ).length;
  console.log(`Seeded ${seededModels} default AI models`);
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
