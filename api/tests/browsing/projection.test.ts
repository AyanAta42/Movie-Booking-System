import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ShowtimeModel } from "../../src/models/catalog";
import { get } from "../helpers/client";
import { prisma } from "../helpers/db";
import { startServer, stopServer } from "../helpers/server";

/// The contract between the two services.
///
/// Browsing lists showtimes from its Mongo copy; booking opens them from
/// Postgres. The only thing joining them is the show id. If the copy drifts —
/// a missing show, a mismatched id, a different price — a customer clicks a
/// showing on one service and the other has never heard of it. These tests are
/// what makes "each service owns its own data" safe to rely on.

describe("the showtime projection, Postgres -> Mongo", () => {
  beforeAll(startServer);
  afterAll(stopServer);

  it("copies every show, under the same id", async () => {
    const pg = await prisma.show.findMany({ select: { id: true } });
    const mongo = await ShowtimeModel.find({}, { _id: 1 }).lean();

    expect(mongo.map((d) => d._id).sort()).toEqual(pg.map((s) => s.id).sort());
  });

  it("copies each show's details exactly", async () => {
    const pg = await prisma.show.findMany({
      select: {
        id: true, movieId: true, startsAt: true, endsAt: true, format: true, priceCents: true,
        screen: { select: { name: true, cinemaId: true } },
      },
    });
    const copies = new Map(
      (await ShowtimeModel.find({}).lean()).map((d) => [d._id, d])
    );

    for (const s of pg) {
      const c = copies.get(s.id)!;
      expect({
        cinemaId: c.cinemaId, movieId: c.movieId, screen: c.screen, format: c.format,
        priceCents: c.priceCents, startsAt: c.startsAt.getTime(), endsAt: c.endsAt.getTime(),
      }).toEqual({
        cinemaId: s.screen.cinemaId, movieId: s.movieId, screen: s.screen.name, format: s.format,
        priceCents: s.priceCents, startsAt: s.startsAt.getTime(), endsAt: s.endsAt.getTime(),
      });
    }
  });

  it("every showing browsing lists opens on booking, naming the same film", async () => {
    const cinemas = (await get("/cinemas")).body;

    for (const cinema of cinemas) {
      const listing = (await get(`/cinemas/${cinema.slug}/showtimes`)).body;

      for (const group of listing.movies) {
        for (const show of group.shows) {
          // Browsing's id, handed to booking — exactly what the seat map page does.
          const map = await get(`/shows/${show.id}/seats`);

          expect(map.status).toBe(200);
          expect(map.body.show.movieTitle).toBe(group.movie.title);
          expect(map.body.show.cinema).toBe(cinema.name);
          expect(map.body.show.screen).toBe(show.screen);
          expect(map.body.show.startsAt).toBe(show.startsAt);
          // The price listed is the price charged.
          expect(new Set(map.body.seats.map((s: any) => s.priceCents))).toEqual(
            new Set([show.priceCents])
          );
        }
      }
    }
  });
});
