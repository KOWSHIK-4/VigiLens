import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("admin123", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@vigilens.io" },
    update: {},
    create: {
      email: "admin@vigilens.io",
      password,
      name: "Admin User",
      role: "admin",
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

  console.log({ admin, entrance, parking, lobby, warehouse, demoFile });

  console.log({ admin, camera });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
