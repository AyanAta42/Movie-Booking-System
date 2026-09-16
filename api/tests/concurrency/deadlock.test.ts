import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDevice, reserve } from "../helpers/client";
import { startServer, stopServer } from "../helpers/server";
import { invariantViolations, resetShow, seatsOf, testShow } from "../helpers/db";

/// The test that justifies `ORDER BY ss.seat_id ... FOR UPDATE`.
///
/// Without deterministic lock ordering, two callers wanting the same seats in
/// opposite orders can each hold one row and wait on the other's. Postgres
/// breaks the cycle after ~1s by killing one side with error 40P01, which
/// surfaces as a 500 — not a 409. So the assertion is: every response is either
/// a win or an honest conflict, and nothing is a server error.
///
/// A single-seat test can never produce this. It needs overlapping multi-seat
/// sets, requested concurrently, in shuffled orders.

describe("deadlock avoidance under overlapping multi-seat claims", () => {
  let showId: string;

  beforeAll(async () => {
    await startServer();
    showId = await testShow();
  });
  afterAll(stopServer);
  beforeEach(() => resetShow(showId));

  it("survives 60 callers fighting over 8 seats in shuffled orders", async () => {
    const seats = await seatsOf(showId, 8);
    const CALLERS = 60;

    const attempts = Array.from({ length: CALLERS }, (_, i) => {
      // Overlapping windows of 3 seats, deliberately requested in a random
      // order so the IN-list order differs between callers.
      const start = i % seats.length;
      const picked = [0, 1, 2].map((o) => seats[(start + o) % seats.length].seatId);
      const shuffled = picked.sort(() => Math.random() - 0.5);
      return reserve(newDevice(), showId, shuffled);
    });

    const results = await Promise.all(attempts);

    const serverErrors = results.filter((r) => r.status >= 500 && r.status !== 503);
    expect(serverErrors.map((r) => r.body)).toEqual([]);

    // Everything is a win, a conflict, or honest backpressure.
    const allowed = results.every((r) => [201, 409, 503].includes(r.status));
    expect(allowed).toBe(true);

    // Somebody has to win.
    expect(results.filter((r) => r.status === 201).length).toBeGreaterThan(0);

    expect(await invariantViolations()).toEqual([]);
  });

  it("keeps the data coherent through a burst across many seats", async () => {
    const seats = await seatsOf(showId, 40);
    const CALLERS = 80;

    const results = await Promise.all(
      Array.from({ length: CALLERS }, () => {
        const start = Math.floor(Math.random() * (seats.length - 4));
        const picked = seats.slice(start, start + 4).map((s) => s.seatId);
        return reserve(newDevice(), showId, picked.sort(() => Math.random() - 0.5));
      })
    );

    expect(results.every((r) => [201, 409, 503].includes(r.status))).toBe(true);
    expect(await invariantViolations()).toEqual([]);
  });
});
