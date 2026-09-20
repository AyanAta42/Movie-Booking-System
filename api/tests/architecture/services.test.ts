import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type Service } from "../../src/app";
import { connectMongo } from "../../src/db/mongo";
import { newDevice } from "../helpers/client";
import { prisma, testShow } from "../helpers/db";

/// Each microservice, run on its own the way a container runs it, answers its
/// own routes and nothing else.

async function serve(service: Service): Promise<{ url: string; server: Server }> {
  const server = await new Promise<Server>((resolve) => {
    const s = createApp(service).listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return { url: `http://127.0.0.1:${addr.port}`, server };
}

const status = async (url: string, init?: RequestInit) => (await fetch(url, init)).status;

describe("services run in isolation", () => {
  let browsing: { url: string; server: Server };
  let booking: { url: string; server: Server };
  let showId: string;

  beforeAll(async () => {
    await connectMongo();
    browsing = await serve("browsing");
    booking = await serve("booking");
    showId = await testShow();
  });
  afterAll(async () => {
    browsing.server.close();
    booking.server.close();
    await prisma.$disconnect();
  });

  it("browsing serves the catalog and nothing of booking's", async () => {
    expect(await status(`${browsing.url}/movies`)).toBe(200);
    expect(await status(`${browsing.url}/cinemas`)).toBe(200);

    expect(await status(`${browsing.url}/shows/${showId}/seats`)).toBe(404);
    expect(
      await status(`${browsing.url}/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-Id": newDevice() },
        body: "{}",
      })
    ).toBe(404);
  });

  it("booking serves seats and reservations and nothing of browsing's", async () => {
    expect(
      await status(`${booking.url}/shows/${showId}/seats`, { headers: { "X-Device-Id": newDevice() } })
    ).toBe(200);

    expect(await status(`${booking.url}/movies`)).toBe(404);
    expect(await status(`${booking.url}/cinemas`)).toBe(404);
  });

  it("each health check reports only the store that service uses", async () => {
    const b = await (await fetch(`${browsing.url}/health`)).json();
    expect(b).toEqual({ service: "browsing", instance: expect.any(String), mongo: "ok" });

    const k = await (await fetch(`${booking.url}/health`)).json();
    expect(k).toEqual({ service: "booking", instance: expect.any(String), postgres: "ok" });
  });

  it("answers under /api too, which is how an AWS load balancer forwards it", async () => {
    expect(await status(`${browsing.url}/api/movies`)).toBe(200);
    expect(await status(`${browsing.url}/api/health`)).toBe(200);
    expect(
      await status(`${booking.url}/api/shows/${showId}/seats`, { headers: { "X-Device-Id": newDevice() } })
    ).toBe(200);
  });

  it("names itself in every response, so load balancing is visible", async () => {
    const res = await fetch(`${booking.url}/health`);
    expect(res.headers.get("x-served-by")).toMatch(/^booking@/);
  });
});
