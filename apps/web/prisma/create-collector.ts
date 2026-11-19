import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const name = process.argv[2] ?? "";

if (!name) {
  console.error("Usage: pnpm --filter web collector:create <name>");
  process.exit(1);
}

async function main() {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const c = await prisma.collector.create({ data: { name, tokenHash } });
  console.log(`COLLECTOR_ID=${c.name}\nCOLLECTOR_TOKEN=${token}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
