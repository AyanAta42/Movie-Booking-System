import "dotenv/config";
import { hostname } from "node:os";
import express from "express";
import { mongoIsConnected } from "./db/mongo";
import { prisma } from "./db/postgres";
import { isHttpError } from "./errors";
import { browsingRouter } from "./routes/browsing";
import { reservationsRouter } from "./routes/reservations";
import { showsRouter } from "./routes/shows";

/// Which slice of the API a process serves.
///
/// One codebase and one image run as either microservice; the SERVICE env var
/// picks the role. `all` is the monolith — what `npm run dev` and the test
/// suite use — so splitting the deployment changed nothing about running it
/// locally as one process.
export type Service = "browsing" | "booking" | "all";

export const SERVICES: readonly Service[] = ["browsing", "booking", "all"];

/// The stores each service is allowed to touch. Browsing reads Mongo only;
/// booking reads Postgres only (DECISIONS entry 4). A service is not even
/// given the connection string for the other store, and
/// tests/architecture/boundaries.test.ts fails if its code imports it.
export function storesFor(service: Service): { postgres: boolean; mongo: boolean } {
  return { postgres: service !== "browsing", mongo: service !== "booking" };
}

/// The Express app, with no `listen`. Kept separate from index.ts so tests can
/// import it and drive it without binding a port — two test files binding 4000
/// would otherwise fight over it.
export function createApp(service: Service = "all") {
  const app = express();
  app.use(express.json());

  // Behind the gateway there are several replicas of each service. This header
  // says which one answered, which is how load balancing becomes visible.
  const servedBy = `${service}@${hostname()}`;
  app.use((_req, res, next) => {
    res.setHeader("X-Served-By", servedBy);
    next();
  });

  const routes = express.Router();
  if (service === "browsing" || service === "all") routes.use(browsingRouter);
  if (service === "booking" || service === "all") routes.use(bookingRoutes());
  routes.get("/health", healthCheck(service));

  // Served at both /movies and /api/movies. The browser calls /api/...; the Vite
  // dev proxy strips that prefix, but an AWS load balancer cannot rewrite paths
  // and forwards /api/movies as-is. Answering both means the same image works
  // behind either without a rewrite layer in front of it.
  app.use(routes);
  app.use("/api", routes);

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

/// Write path. Consistency-first, strictly serialised, fails closed. Postgres
/// only.
///
/// The seat map lives here rather than in browsing even though it is a read:
/// it reports seat state, which must be fresh and is owned by this path
/// (DECISIONS entry 1). Browsing is allowed to be stale; the seat map is not.
function bookingRoutes() {
  const router = express.Router();
  router.use("/shows", showsRouter);
  router.use("/reservations", reservationsRouter);
  return router;
}

/// Reports only the stores this service uses. A booking replica whose Mongo is
/// unreachable is perfectly healthy — it never talks to Mongo — and reporting
/// otherwise would have the load balancer pull a working replica out of service.
function healthCheck(service: Service): express.RequestHandler {
  const uses = storesFor(service);

  return async (_req, res) => {
    const checks: Record<string, "ok" | "down"> = {};

    if (uses.postgres) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.postgres = "ok";
      } catch {
        checks.postgres = "down";
      }
    }
    if (uses.mongo) checks.mongo = mongoIsConnected() ? "ok" : "down";

    const healthy = Object.values(checks).every((c) => c === "ok");
    res.status(healthy ? 200 : 503).json({ service, instance: hostname(), ...checks });
  };
}
