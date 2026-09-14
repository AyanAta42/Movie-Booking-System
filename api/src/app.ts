import "dotenv/config";
import express from "express";
import { mongoIsConnected } from "./db/mongo";
import { prisma } from "./db/postgres";
import { BadRequestError, isHttpError } from "./errors";
import { listCinemas } from "./queries/cinemas";
import { listMovies } from "./queries/movies";
import { listShowtimes } from "./queries/shows";
import { reservationsRouter } from "./routes/reservations";
import { showsRouter } from "./routes/shows";

/// The Express app, with no `listen`. Kept separate from index.ts so tests can
/// import it and drive it without binding a port — two test files binding 4000
/// would otherwise fight over it.
export function createApp() {
  const app = express();
  app.use(express.json());

  // ---- Read path. Availability-first, cacheable, safe to serve stale. ----

  app.get("/movies", async (_req, res, next) => {
    try {
      res.json(await listMovies());
    } catch (err) {
      next(err);
    }
  });

  app.get("/cinemas", async (_req, res, next) => {
    try {
      res.json(await listCinemas());
    } catch (err) {
      next(err);
    }
  });

  app.get("/cinemas/:slug/showtimes", async (req, res, next) => {
    try {
      const raw = req.query.date;
      if (raw !== undefined && typeof raw !== "string") {
        throw new BadRequestError("date must be given at most once");
      }
      res.json(await listShowtimes(req.params.slug, raw));
    } catch (err) {
      next(err);
    }
  });

  app.use("/shows", showsRouter);

  // ---- Write path. Consistency-first, strictly serialised, fails closed. ----

  app.use("/reservations", reservationsRouter);

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
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      // A client mistake is not worth a stack trace in the log, and its message
      // is safe to hand back — these errors are constructed by us.
      if (isHttpError(err)) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }

      console.error(err);
      res.status(500).json({ error: "internal_error" });
    }
  );

  return app;
}
