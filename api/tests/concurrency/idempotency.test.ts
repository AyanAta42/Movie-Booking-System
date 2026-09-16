import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDevice, reserve } from "../helpers/client";
import { startServer, stopServer } from "../helpers/server";
import { countByStatus, invariantViolations, prisma, resetShow, seatsOf, testShow } from "../helpers/db";

/// A double-tap on Reserve, and a retry after a flaky network, must produce one
/// hold — not two, and not a self-inflicted 409 where the user's first request
/// takes the seats their second request then fails to get.

describe("idempotency", () => {
  let showId: string;

  beforeAll(async () => {
    await startServer();
    showId = await testShow();
  });
  afterAll(stopServer);
  beforeEach(() => resetShow(showId));

  it("collapses 10 simultaneous identical requests into one hold", async () => {
    const [s1, s2] = await seatsOf(showId, 2);
    const device = newDevice();
    const key = `${showId}:${[s1.seatId, s2.seatId].sort().join(",")}`;

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserve(device, showId, [s1.seatId, s2.seatId], key))
    );

    // Every caller succeeds. None of them sees a conflict caused by themselves.
    // Compared as a list so a failure shows exactly which statuses came back.
    expect(results.map((r) => `${r.status} ${r.code ?? ""}`.trim())).toEqual(
      Array.from({ length: 10 }, () => "201")
    );

    // And they all get the same reservation back.
    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1);

    expect(await prisma.hold.count({ where: { showId } })).toBe(1);
    expect(await countByStatus(showId, "HELD")).toBe(2);
    expect(await invariantViolations()).toEqual([]);
  });

  /// Same scenario as above with one difference: the device has made a request
  /// before. That takes the users row out of the race, so this isolates the
  /// reservation's own idempotency from the middleware's user creation.
  ///
  /// If this passes while the test above fails, reserve.ts is correct and the
  /// problem is upstream of it, in attachDevice.
  it("collapses 10 simultaneous identical requests from a known device", async () => {
    const [s1, s2, warmup] = await seatsOf(showId, 3);
    const device = newDevice();

    // Any authenticated request registers the device.
    const first = await reserve(device, showId, [warmup.seatId]);
    expect(first.status).toBe(201);

    const key = `${showId}:${[s1.seatId, s2.seatId].sort().join(",")}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserve(device, showId, [s1.seatId, s2.seatId], key))
    );

    expect(results.map((r) => `${r.status} ${r.code ?? ""}`.trim())).toEqual(
      Array.from({ length: 10 }, () => "201")
    );
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    // The warmup hold plus exactly one more.
    expect(await prisma.hold.count({ where: { showId } })).toBe(2);
    expect(await invariantViolations()).toEqual([]);
  });

  it("replays the original hold on a later retry with the same key", async () => {
    const [seat] = await seatsOf(showId, 1);
    const device = newDevice();
    const key = "retry-after-timeout";

    const first = await reserve(device, showId, [seat.seatId], key);
    const retry = await reserve(device, showId, [seat.seatId], key);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(await prisma.hold.count({ where: { showId } })).toBe(1);
  });

  it("treats a different seat selection as a different request", async () => {
    const [s1, s2] = await seatsOf(showId, 2);
    const device = newDevice();

    const first = await reserve(device, showId, [s1.seatId], `${showId}:${s1.seatId}`);
    const second = await reserve(device, showId, [s2.seatId], `${showId}:${s2.seatId}`);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(await prisma.hold.count({ where: { showId } })).toBe(2);
  });

  it("keys are scoped per user, so two devices with the same key do not collide", async () => {
    const [s1, s2] = await seatsOf(showId, 2);
    // Identical key text: the client builds it from show + seats, so two people
    // choosing the same seats genuinely generate the same string.
    const key = `${showId}:shared-key`;

    const a = await reserve(newDevice(), showId, [s1.seatId], key);
    const b = await reserve(newDevice(), showId, [s2.seatId], key);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).not.toBe(a.body.id);
  });
});
