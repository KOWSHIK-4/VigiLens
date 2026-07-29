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

  const camera = await prisma.camera.upsert({
    where: { id: "demo-camera-1" },
    update: {},
    create: {
      id: "demo-camera-1",
      name: "Main Entrance",
      url: "rtsp://camera-stream",
      location: "Building A, Floor 1",
      status: "online",
    },
  });

  console.log({ admin, camera });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
