import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { ADMIN_DATABASE_URL, TEST_DATABASE_URL, TEST_DB, TEST_MONGO_URL } from "./config";

/// Runs once before the whole suite.
///
/// 1. Create the test database if it is not there.
/// 2. Apply the committed migrations to it.
/// 3. Seed it, but only if it is empty — seeding 44,800 show_seats on every run
///    would dominate the runtime. `TEST_RESEED=1` forces it.
export default async function globalSetup() {
  await createDatabase();

  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, MONGO_URL: TEST_MONGO_URL };

  console.log("[tests] applying migrations…");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });

  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  try {
    const seats = await prisma.showSeat.count();
    if (seats === 0 || process.env.TEST_RESEED === "1") {
      console.log("[tests] seeding test database (this takes a moment)…");
      execSync("npx tsx src/seed/mongo.ts", { stdio: "inherit", env });
      execSync("npx tsx src/seed/postgres.ts", { stdio: "inherit", env });
    } else {
      console.log(`[tests] reusing seeded database (${seats} show_seats)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function createDatabase() {
  const admin = new PrismaClient({ datasourceUrl: ADMIN_DATABASE_URL });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
    console.log(`[tests] created database ${TEST_DB}`);
  } catch (err) {
    // Already there. The only outcome we tolerate — anything else (bad
    // credentials, server down) should fail loudly rather than surface later as
    // a confusing migration error.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("already exists")) throw err;
  } finally {
    await admin.$disconnect();
  }
}
