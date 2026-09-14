import { PrismaClient } from "@prisma/client";
import "dotenv/config";

// Singleton. Never construct a PrismaClient anywhere else — each instance owns
// its own connection pool, and `tsx watch` re-executing this module on every
// file change would otherwise leak pools until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function disconnectPostgres(): Promise<void> {
  await prisma.$disconnect();
}
