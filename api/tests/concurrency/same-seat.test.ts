import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDevice, reserve } from "../helpers/client";
import { startServer, stopServer } from "../helpers/server";
import { countByStatus, invariantViolations, resetShow, seatsOf, seatStatus, testShow } from "../helpers/db";

/// The requirement the whole platform exists for:
///
///   Two people click seat F12 at the same millisecond.
///   Exactly one gets it. Never both. Never neither.

describe("one seat, many claimants", () => {
  let showId: string;

  beforeAll(async () => {
    await startServer();
    showId = await testShow();
  });
  afterAll(stopServer);
  beforeEach(() => resetShow(showId));

  it("gives the seat to exactly one of 25 simultaneous callers", async () => {
    const [seat] = await seatsOf(showId, 1);
    const CALLERS = 25;

    const results = await Promise.all(
      Array.from({ length: CALLERS }, () => reserve(newDevice(), showId, [seat.seatId]))
    );

    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status === 409);

    // Never both.
    expect(won).toHaveLength(1);
    // Never neither.
    expect(lost).toHaveLength(CALLERS - 1);
    // Nothing else — a 500 here means a real bug, not contention.
    expect(won.length + lost.length).toBe(CALLERS);

    // And the database agrees with what the callers were told.
    const row = await seatStatus(showId, seat.seatId);
    expect(row.status).toBe("HELD");
    expect(row.holdId).toBe(won[0].body.id);
    expect(await countByStatus(showId, "HELD")).toBe(1);

    expect(await invariantViolations()).toEqual([]);
  });

  it("tells losers how many seats they missed", async () => {
    const [seat] = await seatsOf(showId, 1);

    const [, second] = await Promise.all([
      reserve(newDevice(), showId, [seat.seatId]),
      reserve(newDevice(), showId, [seat.seatId]),
    ]);

    const loser = second.status === 409 ? second : null;
    if (loser) {
      expect(loser.code).toBe("conflict");
      expect(loser.body.message).toMatch(/0 of 1 seats/);
    }
  });

  it("releases the seat to the next caller once the winner's hold is gone", async () => {
    const [seat] = await seatsOf(showId, 1);

    const first = await reserve(newDevice(), showId, [seat.seatId]);
    expect(first.status).toBe(201);

    const blocked = await reserve(newDevice(), showId, [seat.seatId]);
    expect(blocked.status).toBe(409);

    await resetShow(showId);

    const after = await reserve(newDevice(), showId, [seat.seatId]);
    expect(after.status).toBe(201);
  });
});
