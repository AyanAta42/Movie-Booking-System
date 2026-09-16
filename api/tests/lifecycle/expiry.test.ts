import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDevice, reserve } from "../helpers/client";
import { startServer, stopServer } from "../helpers/server";
import {
  forceExpire, invariantViolations, prisma, resetShow, seatsOf, seatStatus, testShow,
} from "../helpers/db";

/// Expiry is resolved lazily, inside the next reserve() for that show — there is
/// no sweeper. So the behaviour to prove is: a lapsed hold stops claiming its
/// seats the moment somebody tries to take them, and not before.

describe("lazy expiry", () => {
  let showId: string;

  beforeAll(async () => {
    await startServer();
    showId = await testShow();
  });
  afterAll(stopServer);
  beforeEach(() => resetShow(showId));

  it("hands an expired hold's seats to the next caller", async () => {
    const [seat] = await seatsOf(showId, 1);

    const first = await reserve(newDevice(), showId, [seat.seatId]);
    expect(first.status).toBe(201);

    await forceExpire(first.body.id);

    const second = await reserve(newDevice(), showId, [seat.seatId]);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);

    const row = await seatStatus(showId, seat.seatId);
    expect(row.status).toBe("HELD");
    expect(row.holdId).toBe(second.body.id);

    expect(await invariantViolations()).toEqual([]);
  });

  it("marks the lapsed hold EXPIRED rather than leaving it ACTIVE", async () => {
    const [s1, s2] = await seatsOf(showId, 2);

    const stale = await reserve(newDevice(), showId, [s1.seatId]);
    await forceExpire(stale.body.id);

    // Any reserve on this show triggers the sweep — even for a different seat.
    await reserve(newDevice(), showId, [s2.seatId]);

    const hold = await prisma.hold.findUnique({
      where: { id: stale.body.id },
      select: { status: true },
    });
    expect(hold?.status).toBe("EXPIRED");

    // And its seat was released, not left dangling.
    const row = await seatStatus(showId, s1.seatId);
    expect(row.status).toBe("AVAILABLE");
    expect(row.holdId).toBeNull();
  });

  it("does not expire a hold that still has time left", async () => {
    const [seat] = await seatsOf(showId, 1);

    const live = await reserve(newDevice(), showId, [seat.seatId]);
    const other = await reserve(newDevice(), showId, [seat.seatId]);

    expect(other.status).toBe(409);

    const hold = await prisma.hold.findUnique({
      where: { id: live.body.id },
      select: { status: true },
    });
    expect(hold?.status).toBe("ACTIVE");
  });

  it("reports a positive countdown on a fresh hold", async () => {
    const [seat] = await seatsOf(showId, 1);
    const held = await reserve(newDevice(), showId, [seat.seatId]);

    expect(held.body.secondsRemaining).toBeGreaterThan(0);
    expect(held.body.secondsRemaining).toBeLessThanOrEqual(600);
    expect(held.body.expiresAt).toBeTruthy();
  });
});
