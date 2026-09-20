import { Router } from "express";
import { BadRequestError } from "../errors";
import { listCinemas } from "../queries/cinemas";
import { listMovies } from "../queries/movies";
import { listShowtimes } from "../queries/shows";

/// The browsing service's routes. Read path: availability-first, cacheable,
/// safe to serve stale.
///
/// Mongo only — the catalog, plus browsing's projection of cinemas and
/// showtimes. Nothing reachable from this file may import the Postgres client;
/// tests/architecture/boundaries.test.ts enforces it.
export const browsingRouter = Router();

browsingRouter.get("/movies", async (_req, res, next) => {
  try {
    res.json(await listMovies());
  } catch (err) {
    next(err);
  }
});

browsingRouter.get("/cinemas", async (_req, res, next) => {
  try {
    res.json(await listCinemas());
  } catch (err) {
    next(err);
  }
});

browsingRouter.get("/cinemas/:slug/showtimes", async (req, res, next) => {
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
