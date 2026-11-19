import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 chars) before seeding.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, role: "ADMIN", name: "Administrator" },
  });
  await prisma.auditLog.create({ data: { userId: user.id, action: "admin.seeded" } });
  console.log(`Administrator ready: ${email}`);
}

main().finally(() => prisma.$disconnect());
