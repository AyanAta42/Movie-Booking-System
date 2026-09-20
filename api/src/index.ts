import "dotenv/config";
import { createApp, SERVICES, storesFor, type Service } from "./app";
import { connectMongo, disconnectMongo } from "./db/mongo";
import { disconnectPostgres } from "./db/postgres";

const port = Number(process.env.PORT ?? 4000);

function serviceFromEnv(): Service {
  const raw = process.env.SERVICE ?? "all";
  if (!SERVICES.includes(raw as Service)) {
    throw new Error(`SERVICE must be one of ${SERVICES.join(", ")}, received "${raw}"`);
  }
  return raw as Service;
}

async function start() {
  const service = serviceFromEnv();

  // Connect only to what this service uses. Booking is not given MONGO_URL at
  // all, so connecting unconditionally would crash it at startup. Postgres needs
  // no step here: Prisma connects lazily on the first query, which browsing
  // never makes.
  if (storesFor(service).mongo) await connectMongo();

  // 0.0.0.0, not localhost: the point of this build is testing from a phone on
  // the same network, which cannot reach a loopback-only bind — and inside a
  // container, loopback is unreachable from the gateway too.
  const server = createApp(service).listen(port, "0.0.0.0", () =>
    console.log(`[api] ${service} listening on http://0.0.0.0:${port}`)
  );

  // Containers are stopped with SIGTERM — on every deploy, scale-in, or
  // `docker compose down`. Without a handler, node running as PID 1 ignores it
  // and gets SIGKILLed after the grace period, cutting off any reservation
  // mid-transaction. Stop taking new requests, let in-flight ones finish, then
  // release the database connections.
  process.once("SIGTERM", () => {
    console.log(`[api] ${service} draining`);
    server.close(async () => {
      await Promise.allSettled([disconnectPostgres(), disconnectMongo()]);
      process.exit(0);
    });
    // Under compose's 10s grace period, so we exit on our own terms.
    setTimeout(() => process.exit(1), 8_000).unref();
  });
}

start().catch((err) => {
  console.error("[api] failed to start", err);
  process.exit(1);
});
