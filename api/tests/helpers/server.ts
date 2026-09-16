import type { Server } from "node:http";
import { createApp } from "../../src/app";

/// One real HTTP server per test file, on an ephemeral port.
///
/// Requests go over a real socket rather than through an in-process helper,
/// because the thing being tested is what happens when N requests genuinely
/// overlap. Anything that serialises them invalidates the whole suite.
let server: Server | null = null;
let base = "";

export async function startServer(): Promise<string> {
  if (server) return base;

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
/// Connections are opened in small batches with retries, because a warm-up
/// that itself bursts 40 connects just moves the same failure here and takes
/// the whole file down with it.
async function warmPool(): Promise<void> {
  const { prisma } = await import("../../src/db/postgres");
  const BATCH = 8;
  const TOTAL = 40;
  const ATTEMPTS = 5;

  for (let opened = 0; opened < TOTAL; opened += BATCH) {
    for (let attempt = 1; ; attempt++) {
      try {
        await Promise.all(Array.from({ length: BATCH }, () => prisma.$queryRaw`SELECT 1`));
        break;
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
