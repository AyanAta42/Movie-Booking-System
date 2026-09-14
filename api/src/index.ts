import "dotenv/config";
import express from "express";
import { connectMongo, mongoIsConnected } from "./db/mongo";
import { prisma } from "./db/postgres";
import { listMovies } from "./queries/movies";

const app = express();
app.use(express.json());

// Read path. Availability-first: this endpoint is allowed to serve slightly
// stale data, and once Redis arrives it is the first thing to sit behind a cache.
app.get("/movies", async (_req, res, next) => {
  try {
    res.json(await listMovies());
  } catch (err) {
    next(err);
  }
});

app.get("/health", async (_req, res) => {
  const checks = { postgres: "down", mongo: "down" };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = "ok";
  } catch {
    /* leave as down */
  }

  checks.mongo = mongoIsConnected() ? "ok" : "down";

  const healthy = checks.postgres === "ok" && checks.mongo === "ok";
  res.status(healthy ? 200 : 503).json(checks);
});

// Error middleware. Classes are used for error types precisely so that
// `instanceof` narrowing works here — that is the only place they earn their keep.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

const port = Number(process.env.PORT ?? 4000);

async function start() {
  await connectMongo();
  app.listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
}

start().catch((err) => {
  console.error("[api] failed to start", err);
  process.exit(1);
});
