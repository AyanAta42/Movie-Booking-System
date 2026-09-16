/// Load probe. Not a pass/fail test — it produces the numbers.
///
/// Run it to answer two different questions, because they fail differently:
///
///   --mode=contended   everyone fights over a handful of seats. Lock-bound.
///                      Expect mostly 409s. Measures how well losers are shed.
///   --mode=spread      seats picked at random across the show. Pool-bound.
///                      Expect mostly 201s, then 503s once the pool saturates.
///
/// Usage:
///   npm run test:load
///   npm run test:load -- --mode=spread --clients=400
///   npm run test:load -- --mode=contended --clients=200 --seats=4 --rounds=3
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { TEST_DATABASE_URL, TEST_MONGO_URL } from "../config";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.MONGO_URL = TEST_MONGO_URL;

type Args = { mode: "contended" | "spread"; clients: number; seats: number; rounds: number };

function parseArgs(): Args {
  const get = (name: string, fallback: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

  const mode = get("mode", "contended");
  if (mode !== "contended" && mode !== "spread") {
    throw new Error(`--mode must be "contended" or "spread", got "${mode}"`);
  }
  return {
    mode,
    clients: Number(get("clients", "200")),
    seats: Number(get("seats", mode === "contended" ? "5" : "150")),
    rounds: Number(get("rounds", "1")),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function main() {
  const args = parseArgs();

  // Imported after DATABASE_URL is set — the Prisma singleton reads it at load.
  const { createApp } = await import("../../src/app");
  const { prisma, resetShow, seatsOf, testShow, invariantViolations } = await import("../helpers/db");

  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${addr.port}`;

  const showId = await testShow();
  const pool = await seatsOf(showId, args.seats);

  console.log(
    `\n  mode=${args.mode}  clients=${args.clients}  seat pool=${pool.length}  rounds=${args.rounds}\n`
  );

  for (let round = 1; round <= args.rounds; round++) {
    await resetShow(showId);

    const latencies: number[] = [];
    const byStatus = new Map<number, number>();

    const fire = async () => {
      const seatIds =
        args.mode === "contended"
          ? [pool[Math.floor(Math.random() * pool.length)].seatId]
          : (() => {
              const start = Math.floor(Math.random() * (pool.length - 2));
              return pool.slice(start, start + 2).map((s) => s.seatId);
            })();

      const started = performance.now();
      try {
        const res = await fetch(`${base}/reservations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Device-Id": randomUUID() },
          body: JSON.stringify({ showId, seatIds, idempotencyKey: randomUUID() }),
        });
        await res.arrayBuffer();
        byStatus.set(res.status, (byStatus.get(res.status) ?? 0) + 1);
      } catch {
        byStatus.set(0, (byStatus.get(0) ?? 0) + 1);
      } finally {
        latencies.push(performance.now() - started);
      }
    };

    const wallStart = performance.now();
    await Promise.all(Array.from({ length: args.clients }, fire));
    const wallMs = performance.now() - wallStart;

    latencies.sort((a, b) => a - b);
    const ok = byStatus.get(201) ?? 0;

    console.log(`  ── round ${round} ────────────────────────────────`);
    for (const [status, count] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
      const pct = ((count / args.clients) * 100).toFixed(1).padStart(5);
      console.log(`   ${label(status)}  ${String(count).padStart(5)}  ${pct}%`);
    }
    console.log(`   ${"wall".padEnd(22)} ${wallMs.toFixed(0)} ms`);
    console.log(`   ${"reservations/sec".padEnd(22)} ${((ok / wallMs) * 1000).toFixed(1)}`);
    console.log(
      `   p50 ${percentile(latencies, 50).toFixed(0)} ms   ` +
        `p95 ${percentile(latencies, 95).toFixed(0)} ms   ` +
        `p99 ${percentile(latencies, 99).toFixed(0)} ms   ` +
        `max ${latencies[latencies.length - 1].toFixed(0)} ms`
    );

    const held = await prisma.showSeat.count({ where: { showId, status: "HELD" } });
    console.log(`   seats actually held      ${held}`);

    const violations = await invariantViolations();
    if (violations.length === 0) {
      console.log(`   invariants               OK`);
    } else {
      console.log(`   invariants               ${violations.length} VIOLATED`);
      for (const v of violations) console.log(`     ✗ ${v.rule}: ${v.detail} (${v.count} rows)`);
      process.exitCode = 1;
    }
    console.log("");
  }

  await resetShow(showId);
  await prisma.$disconnect();
  server.close();
}

function label(status: number): string {
  const names: Record<number, string> = {
    0: "network error       ",
    201: "201 reserved        ",
    400: "400 bad request     ",
    409: "409 taken           ",
    503: "503 too busy        ",
    500: "500 SERVER ERROR    ",
  };
  return names[status] ?? `${status}                 `;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
