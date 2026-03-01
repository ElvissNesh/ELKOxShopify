import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  const session = await prisma.session.findFirst();
  if (!session) {
    console.log("No session found in DB");
    return;
  }
  console.log("Found session for shop:", session.shop);
}
run();
