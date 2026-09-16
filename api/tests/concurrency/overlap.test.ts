import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDevice, reserve } from "../helpers/client";
import { startServer, stopServer } from "../helpers/server";
import { countByStatus, invariantViolations, resetShow, seatsOf, seatStatus, testShow } from "../helpers/db";

/// Partial overlap, not identical picks.
///
/// A wants F1,F2. B wants F2,F3. They share exactly one seat. The winner takes
/// both of theirs; the loser must end up with NOTHING — including the seat
/// nobody was competing for. That is the all-or-nothing rule, and it is the
/// assertion most likely to catch a broken rollback.

describe("overlapping seat selections", () => {
  let showId: string;

  beforeAll(async () => {
    await startServer();
    showId = await testShow();
  });
  afterAll(stopServer);
  beforeEach(() => resetShow(showId));

  it("lets one caller through and leaves the loser with zero seats", async () => {
    const [s1, s2, s3] = await seatsOf(showId, 3);

    const [a, b] = await Promise.all([
      reserve(newDevice(), showId, [s1.seatId, s2.seatId]),
      reserve(newDevice(), showId, [s2.seatId, s3.seatId]),
    ]);

    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;

    expect(winner.status).toBe(201);
    expect(loser.status).toBe(409);
    expect(loser.body.message).toMatch(/1 of 2 seats/);

    // Exactly two seats held in total — the winner's pair, nothing else.
    expect(await countByStatus(showId, "HELD")).toBe(2);
    expect(winner.body.seats).toHaveLength(2);

    // The seat the loser could have had is free again. If the rollback were
    // broken this would be HELD by a hold that no longer exists.
    const uncontested = winner === a ? s3 : s1;
    const row = await seatStatus(showId, uncontested.seatId);
    expect(row.status).toBe("AVAILABLE");
    expect(row.holdId).toBeNull();

    expect(await invariantViolations()).toEqual([]);
  });

  it("leaves no hold behind when a claim fails", async () => {
    const [s1, s2, s3] = await seatsOf(showId, 3);

    await reserve(newDevice(), showId, [s2.seatId]);
    const failed = await reserve(newDevice(), showId, [s1.seatId, s2.seatId, s3.seatId]);

    expect(failed.status).toBe(409);
    expect(failed.body.message).toMatch(/2 of 3 seats/);

    // One hold exists: the first caller's. The failed attempt created a hold
    // row inside its transaction and it must have rolled back with it.
    const { prisma } = await import("../helpers/db");
    expect(await prisma.hold.count({ where: { showId } })).toBe(1);

    expect(await invariantViolations()).toEqual([]);
  });

  it("does not interfere with callers who want different seats", async () => {
    const seats = await seatsOf(showId, 8);

    const results = await Promise.all([
      reserve(newDevice(), showId, [seats[0].seatId, seats[1].seatId]),
      reserve(newDevice(), showId, [seats[2].seatId, seats[3].seatId]),
      reserve(newDevice(), showId, [seats[4].seatId, seats[5].seatId]),
      reserve(newDevice(), showId, [seats[6].seatId, seats[7].seatId]),
    ]);

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await countByStatus(showId, "HELD")).toBe(8);
    expect(await invariantViolations()).toEqual([]);
  });
});
