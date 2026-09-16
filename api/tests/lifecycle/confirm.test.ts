import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirm, getReservation, newDevice, reserve } from "../helpers/client";
import { startServer, stopServer } from "../helpers/server";
import {
  countByStatus, forceExpire, invariantViolations, resetShow, seatsOf, seatStatus, testShow,
} from "../helpers/db";

/// Confirming is irreversible — there is no payment step and nothing ever
/// releases a BOOKED seat. The guarantees worth proving are that it is safe to
/// retry, impossible after expiry, and scoped to its owner.

describe("confirming a hold", () => {
  let showId: string;

  beforeAll(async () => {
    await startServer();
    showId = await testShow();
  });
  afterAll(stopServer);
  beforeEach(() => resetShow(showId));

  it("turns held seats into booked ones", async () => {
    const [s1, s2] = await seatsOf(showId, 2);
    const device = newDevice();

    const held = await reserve(device, showId, [s1.seatId, s2.seatId]);
    const done = await confirm(device, held.body.id);

    expect(done.status).toBe(200);
    expect(done.body.status).toBe("CONFIRMED");
    // A booking does not expire, so the countdown is gone.
    expect(done.body.expiresAt).toBeNull();
    expect(done.body.secondsRemaining).toBe(0);

    expect(await countByStatus(showId, "BOOKED")).toBe(2);
    expect(await invariantViolations()).toEqual([]);
  });

  it("treats a double-tap on Confirm as success, not an error", async () => {
    const [seat] = await seatsOf(showId, 1);
    const device = newDevice();
    const held = await reserve(device, showId, [seat.seatId]);

    const [a, b] = await Promise.all([
      confirm(device, held.body.id),
      confirm(device, held.body.id),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.status).toBe("CONFIRMED");
    expect(b.body.status).toBe("CONFIRMED");

    expect(await countByStatus(showId, "BOOKED")).toBe(1);
    expect(await invariantViolations()).toEqual([]);
  });

  it("refuses to confirm a hold whose time ran out", async () => {
    const [seat] = await seatsOf(showId, 1);
    const device = newDevice();
    const held = await reserve(device, showId, [seat.seatId]);

    await forceExpire(held.body.id);

    const tooLate = await confirm(device, held.body.id);
    expect(tooLate.status).toBe(410);
    expect(tooLate.code).toBe("gone");
    expect(tooLate.body.message).toMatch(/expired/i);

    expect(await countByStatus(showId, "BOOKED")).toBe(0);
  });

  it("protects a confirmed booking from another caller's expiry sweep", async () => {
    const [seat] = await seatsOf(showId, 1);
    const device = newDevice();

    const held = await reserve(device, showId, [seat.seatId]);
    await confirm(device, held.body.id);

    // The hold's ten minutes now lapse. A confirmed hold must be invisible to
    // the reclaim — it is CONFIRMED, not ACTIVE — so the seat stays sold.
    await forceExpire(held.body.id);

    const thief = await reserve(newDevice(), showId, [seat.seatId]);
    expect(thief.status).toBe(409);

    const row = await seatStatus(showId, seat.seatId);
    expect(row.status).toBe("BOOKED");
    expect(await invariantViolations()).toEqual([]);
  });

  it("hides another device's reservation", async () => {
    const [seat] = await seatsOf(showId, 1);
    const owner = newDevice();
    const held = await reserve(owner, showId, [seat.seatId]);

    const snooper = await getReservation(newDevice(), held.body.id);
    expect(snooper.status).toBe(404);

    const stolen = await confirm(newDevice(), held.body.id);
    expect(stolen.status).toBe(404);
  });
});
