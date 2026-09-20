import type { Server } from "node:http";
import { createApp } from "../../src/app";
import { connectMongo } from "../../src/db/mongo";

/// One real HTTP server per test file, on an ephemeral port.
///
/// Requests go over a real socket rather than through an in-process helper,
/// because the thing being tested is what happens when N requests genuinely
/// overlap. Anything that serialises them invalidates the whole suite.
let server: Server | null = null;
let base = "";

export async function startServer(): Promise<string> {
  if (server) return base;

  // The test server runs every route (SERVICE=all), so it needs both stores —
  // browsing reads Mongo, booking reads Postgres.
  await connectMongo();

  const app = createApp();
  server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port assigned");
  base = `http://127.0.0.1:${address.port}`;

  await warmPool();
  return base;
}

/// Open the connection pool before the first burst.
///
/// Prisma connects lazily. Without this, the first concurrent test in a file
/// asks for ~40 brand-new TCP connections at the same instant, and on Windows
/// Docker Desktop's port forwarding intermittently drops some of them (P1001).
/// That is a local networking artefact, not contention — a running server's
/// pool is already warm — so it must not be allowed to masquerade as a result.
///
/// Connections are opened a batch at a time, staggered, with every query held
/// open (pg_sleep) until all 40 are in flight together. Both halves matter:
/// a warm-up that bursts 40 connects at once just moves the same failure here,
/// and batches that each finish before the next starts only ever open 8 —
/// Prisma hands the next batch the connections the last one returned. Measured:
/// sequential batches opened 8, this opens 40.
async function warmPool(): Promise<void> {
  const { prisma } = await import("../../src/db/postgres");
  const TOTAL = 40;
  const BATCH = 8;
  const STAGGER_MS = 150;
  const ATTEMPTS = 5;

  for (let attempt = 1; ; attempt++) {
    try {
      const inFlight: Promise<unknown>[] = [];
      for (let started = 0; started < TOTAL; started += BATCH) {
        for (let i = 0; i < BATCH; i++) inFlight.push(prisma.$queryRaw`SELECT 1 FROM pg_sleep(0.5)`);
        await new Promise((r) => setTimeout(r, STAGGER_MS));
      }
      await Promise.all(inFlight);
      return;
    } catch (err) {
      if (attempt === ATTEMPTS) {
        throw new Error(
          `Could not open database connections after ${ATTEMPTS} attempts. ` +
            `Is Docker running? Try restarting Docker Desktop. (${(err as Error).message})`
        );
      }
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
}

export async function stopServer(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  base = "";
  await new Promise<void>((resolve) => s.close(() => resolve()));
}

export function baseUrl(): string {
  if (!base) throw new Error("startServer() was not awaited");
  return base;
}
