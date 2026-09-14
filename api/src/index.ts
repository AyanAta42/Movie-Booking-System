import "dotenv/config";
import express from "express";
import { connectMongo, mongoIsConnected } from "./db/mongo";
import { prisma } from "./db/postgres";
import { BadRequestError, isHttpError } from "./errors";
import { listCinemas } from "./queries/cinemas";
import { listMovies } from "./queries/movies";
import { listShowtimes } from "./queries/shows";

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

// Read path. Drives the cinema filter on the browse page.
app.get("/cinemas", async (_req, res, next) => {
  try {
    res.json(await listCinemas());
  } catch (err) {
    next(err);
  }
});

// Read path. One cinema's schedule for one day. Still availability-first — a
// listing that is a minute stale is fine, and no seat is claimed by reading it.
// `?date=YYYY-MM-DD`; omitted means the first day with showings.
app.get("/cinemas/:slug/showtimes", async (req, res, next) => {
  try {
    const raw = req.query.date;
    if (raw !== undefined && typeof raw !== "string") {
      // Express parses a repeated ?date= into an array. Rejected rather than
      // silently picking one, which would list a day nobody asked for.
      throw new BadRequestError("date must be given at most once");
    }
    res.json(await listShowtimes(req.params.slug, raw));
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
  // A client mistake is not worth a stack trace in the log, and its message is
  // safe to hand back — these errors are constructed by us, from validated input.
  if (isHttpError(err)) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }

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
