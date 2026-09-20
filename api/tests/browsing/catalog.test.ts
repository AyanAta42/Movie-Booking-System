import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { get } from "../helpers/client";
import { startServer, stopServer } from "../helpers/server";

/// The browsing service's routes, answered from Mongo alone: the film catalog
/// plus the projection of cinemas and showtimes.

describe("browsing: the catalog", () => {
  beforeAll(startServer);
  afterAll(stopServer);

  it("lists every film, newest release first", async () => {
    const res = await get("/movies");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(8);
    const dates = res.body.map((m: any) => m.releaseDate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("lists cinemas with their screen counts, by city then name", async () => {
    const res = await get("/cinemas");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    for (const c of res.body) {
      expect(c).toEqual({
        id: expect.any(String),
        slug: expect.any(String),
        name: expect.any(String),
        city: expect.any(String),
        screenCount: expect.any(Number),
      });
      expect(c.screenCount).toBeGreaterThan(0);
    }
    const keys = res.body.map((c: any) => `${c.city}|${c.name}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("lists a day's showtimes at a cinema, grouped by film", async () => {
    const [cinema] = (await get("/cinemas")).body;
    const res = await get(`/cinemas/${cinema.slug}/showtimes`);

    expect(res.status).toBe(200);
    expect(res.body.cinema.slug).toBe(cinema.slug);
    expect(res.body.dates.length).toBeGreaterThan(0);
    // With no date asked for, the first day that has shows.
    expect(res.body.date).toBe(res.body.dates[0]);
    expect(res.body.movies.length).toBeGreaterThan(0);

    for (const group of res.body.movies) {
      expect(group.movie.title).toEqual(expect.any(String));
      for (const show of group.shows) {
        expect(show.movieId).toBe(group.movie.id);
        expect(show.priceCents).toBeGreaterThan(0);
      }
    }

    // Films alphabetical; within a film, showings in time order.
    const titles = res.body.movies.map((g: any) => g.movie.title);
    expect(titles).toEqual([...titles].sort((a: string, b: string) => a.localeCompare(b)));
    for (const group of res.body.movies) {
      const starts = group.shows.map((s: any) => s.startsAt);
      expect(starts).toEqual([...starts].sort());
    }
  });

  it("lists a specific day when asked", async () => {
    const [cinema] = (await get("/cinemas")).body;
    const { dates } = (await get(`/cinemas/${cinema.slug}/showtimes`)).body;
    const lastDay = dates.at(-1);

    const res = await get(`/cinemas/${cinema.slug}/showtimes?date=${lastDay}`);

    expect(res.status).toBe(200);
    expect(res.body.date).toBe(lastDay);
    expect(res.body.movies.length).toBeGreaterThan(0);
  });

  it("rejects bad input with a client error, not a crash", async () => {
    const [cinema] = (await get("/cinemas")).body;

    expect((await get("/cinemas/no-such-cinema/showtimes")).status).toBe(404);
    expect((await get(`/cinemas/${cinema.slug}/showtimes?date=tomorrow`)).status).toBe(400);
    expect((await get(`/cinemas/${cinema.slug}/showtimes?date=2026-02-31`)).status).toBe(400);
  });
});
