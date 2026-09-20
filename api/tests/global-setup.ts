import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { ADMIN_DATABASE_URL, TEST_DATABASE_URL, TEST_DB, TEST_MONGO_URL } from "./config";

/// Runs once before the whole suite.
///
/// 1. Create the test database if it is not there.
/// 2. Apply the committed migrations to it.
/// 3. Seed it, but only if it is empty or predates a schema change — seeding
///    44,800 show_seats on every run would dominate the runtime. `TEST_RESEED=1`
///    forces it.
/// 4. Rebuild browsing's Mongo projection. Cheap (a few hundred documents) and
///    idempotent, so it runs every time: the browsing tests must never pass or
///    fail because of a stale copy left over from an earlier run.
export default async function globalSetup() {
  await createDatabase();

  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, MONGO_URL: TEST_MONGO_URL };

  console.log("[tests] applying migrations…");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });

  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  try {
    const seats = await prisma.showSeat.count();
    // Shows seeded before booking kept its own copy of the film title.
    const untitled = await prisma.show.count({ where: { movieTitle: null } });
    if (seats === 0 || untitled > 0 || process.env.TEST_RESEED === "1") {
      console.log("[tests] seeding test database (this takes a moment)…");
      run("npx tsx src/seed/mongo.ts", env);
      run("npx tsx src/seed/postgres.ts", env);
    } else {
      console.log(`[tests] reusing seeded database (${seats} show_seats)`);
    }

    run("npx tsx src/seed/projection.ts", env);
  } finally {
    await prisma.$disconnect();
  }
}

/// Runs a seed step, retrying on failure.
///
/// Every step is safe to repeat — the Postgres seed wipes and rebuilds, the Mongo
/// seed upserts, the projection replaces — so a retry can only help. It is here
/// because Docker Desktop on Windows intermittently drops a fresh connection,
/// and a suite that fails before running a single test says nothing about the code.
function run(command: string, env: NodeJS.ProcessEnv, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      execSync(command, { stdio: "inherit", env });
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      console.log(`[tests] ${command} failed, retrying (${attempt}/${attempts - 1})…`);
    }
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
