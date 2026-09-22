/// Live load probe. Tests a deployed stack through its public URL, and nothing else.
///
/// burst.ts starts its own server and checks the database directly, so it only
/// works on your machine. This one needs no database access, which is the point:
/// on AWS, Postgres is private and the only way in is the load balancer. Every
/// check below is made through the same API a browser uses.
///
///   --mode=contended  N clients race for a handful of seats. Proves no seat is
///                     ever handed to two people, however hard they collide.
///   --mode=spread     N clients book different seat pairs across one show.
///                     Measures booking throughput and latency.
///   --mode=browse     W workers read films and showtimes for S seconds, printing
///                     a line per second. Measures browsing throughput.
///   --mode=seatmap    Same, against booking's seat map. Stop a booking task in
///                     the ECS console mid-run to watch it fail over.
///
/// Usage (from api/):
///   npm run test:live -- --target=http://<alb-dns> --mode=contended --clients=500 --seats=4
///   npm run test:live -- --target=http://<alb-dns> --mode=spread --clients=200
///   npm run test:live -- --target=http://<alb-dns> --mode=browse --workers=50 --seconds=60
import { randomUUID } from "node:crypto";

type Mode = "contended" | "spread" | "browse" | "seatmap";
/// A reservation claims `seatId`, the physical seat; `id` is the per-show row.
type Seat = { id: string; seatId: string; label: string; status: "AVAILABLE" | "HELD" | "BOOKED" };
type Result = { status: number; ms: number; servedBy: string };

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;

const target = arg("target", "").replace(/\/+$/, "");
const mode = arg("mode", "contended") as Mode;
if (!target) throw new Error("--target=http://<load balancer address> is required");
if (!["contended", "spread", "browse", "seatmap"].includes(mode)) {
  throw new Error(`--mode must be contended, spread, browse or seatmap, got "${mode}"`);
}

async function call(path: string, init: RequestInit = {}): Promise<Result & { body: string }> {
  const started = performance.now();
  try {
    const res = await fetch(`${target}/api${path}`, {
      ...init,
      headers: {
        "X-Device-Id": randomUUID(),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    return { status: res.status, ms: performance.now() - started, servedBy: res.headers.get("x-served-by") ?? "?", body };
  } catch {
    return { status: 0, ms: performance.now() - started, servedBy: "-", body: "" };
  }
}

async function json<T>(path: string): Promise<T> {
  const r = await call(path);
  if (r.status !== 200) throw new Error(`GET /api${path} returned ${r.status}: ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body) as T;
}

/// A future show nobody has touched, so earlier runs cannot skew this one. The
/// seed schedules a week of shows; any of them will do.
async function freshShow(): Promise<{ showId: string; slug: string; seats: Seat[] }> {
  const cinemas = await json<{ slug: string }[]>("/cinemas");
  const candidates: { showId: string; slug: string }[] = [];
  for (const c of cinemas) {
    const t = await json<{ dates: string[] }>(`/cinemas/${c.slug}/showtimes`);
    const date = t.dates[Math.min(1, t.dates.length - 1)]; // tomorrow: nothing has started
    const day = await json<{ movies: { shows: { id: string }[] }[] }>(`/cinemas/${c.slug}/showtimes?date=${date}`);
    for (const m of day.movies) for (const s of m.shows) candidates.push({ showId: s.id, slug: c.slug });
  }
  if (candidates.length === 0) throw new Error("no shows found — has the seed been run?");
  for (let i = 0; i < 20; i++) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const map = await json<{ seats: Seat[] }>(`/shows/${pick.showId}/seats`);
    if (map.seats.every((s) => s.status === "AVAILABLE")) return { ...pick, seats: map.seats };
  }
  throw new Error("could not find an untouched show — re-run the seed to reset them");
}

const pct = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

function latencyLine(ms: number[]): string {
  const s = [...ms].sort((a, b) => a - b);
  return `p50 ${pct(s, 50).toFixed(0)} ms   p95 ${pct(s, 95).toFixed(0)} ms   ` +
    `p99 ${pct(s, 99).toFixed(0)} ms   max ${(s[s.length - 1] ?? 0).toFixed(0)} ms`;
}

const statusName: Record<number, string> = {
  0: "network error / timeout",
  200: "200 ok",
  201: "201 reserved",
  409: "409 seat taken",
  503: "503 too busy (shed)",
  500: "500 SERVER ERROR",
  502: "502 bad gateway",
  504: "504 gateway timeout",
};

function printStatuses(results: Result[]) {
  const by = new Map<number, number>();
  for (const r of results) by.set(r.status, (by.get(r.status) ?? 0) + 1);
  for (const [s, n] of [...by].sort((a, b) => a[0] - b[0])) {
    const share = ((n / results.length) * 100).toFixed(1).padStart(5);
    console.log(`   ${(statusName[s] ?? String(s)).padEnd(26)} ${String(n).padStart(6)}  ${share}%`);
  }
}

function printServers(results: Result[]) {
  const by = new Map<string, number>();
  for (const r of results) if (r.servedBy !== "-") by.set(r.servedBy, (by.get(r.servedBy) ?? 0) + 1);
  console.log(`   answered by ${by.size} server(s):`);
  for (const [s, n] of [...by].sort()) console.log(`     ${s.padEnd(58)} ${n}`);
}

const verdict = (ok: boolean, text: string) => console.log(`\n   ${ok ? "✓ PASS" : "✗ FAIL"}  ${text}\n`);

async function reservationBurst(kind: "contended" | "spread") {
  const clients = Number(arg("clients", kind === "contended" ? "500" : "200"));
  const { showId, seats } = await freshShow();
  const pool = kind === "contended" ? seats.slice(0, Number(arg("seats", "4"))) : seats;
  console.log(`\n  ${kind}: ${clients} clients, ${pool.length} seats in play, show ${showId}\n`);

  const winners = new Map<string, number>(); // seatId -> successful reservations
  const fire = async (): Promise<Result> => {
    let seatIds: string[];
    if (kind === "contended") {
      seatIds = [pool[Math.floor(Math.random() * pool.length)].seatId];
    } else {
      const i = Math.floor(Math.random() * (pool.length - 1));
      seatIds = [pool[i].seatId, pool[i + 1].seatId];
    }
    const r = await call("/reservations", {
      method: "POST",
      body: JSON.stringify({ showId, seatIds, idempotencyKey: randomUUID() }),
    });
    if (r.status === 201) for (const id of seatIds) winners.set(id, (winners.get(id) ?? 0) + 1);
    return r;
  };

  const wall = performance.now();
  const results = await Promise.all(Array.from({ length: clients }, fire));
  const wallMs = performance.now() - wall;
  // Read back straight away: while holds are short, waiting would let them lapse.
  const after = await json<{ seats: Seat[] }>(`/shows/${showId}/seats`);

  printStatuses(results);
  const ok = results.filter((r) => r.status === 201).length;
  console.log(`   ${"wall time".padEnd(26)} ${wallMs.toFixed(0)} ms`);
  console.log(`   ${"reservations/sec".padEnd(26)} ${((ok / wallMs) * 1000).toFixed(1)}`);
  console.log(`   ${"requests/sec".padEnd(26)} ${((results.length / wallMs) * 1000).toFixed(1)}`);
  console.log(`   ${latencyLine(results.map((r) => r.ms))}`);
  printServers(results);

  const doubled = [...winners].filter(([, n]) => n > 1);
  const heldNow = after.seats.filter((s) => s.status !== "AVAILABLE").length;
  console.log(`\n   ${"seats won".padEnd(26)} ${winners.size}`);
  console.log(`   ${"seats API now shows held".padEnd(26)} ${heldNow}`);
  // "Never twice" is vacuously true if nobody wins, so require real winners that
  // agree with what the server now reports, not just the absence of doubles.
  const problems: string[] = [];
  if (ok === 0) problems.push("no request succeeded, so nothing was proven");
  if (doubled.length) problems.push(`${doubled.length} seat(s) were given to more than one person`);
  if (heldNow !== winners.size) problems.push(`${winners.size} seats won but the API shows ${heldNow} held`);
  if (kind === "contended" && winners.size !== pool.length) {
    problems.push(`only ${winners.size} of ${pool.length} contested seats were won`);
  }
  verdict(
    problems.length === 0,
    problems.length === 0
      ? `every seat went to exactly one person (${ok} winners, ${results.length - ok} turned away)`
      : problems.join("; ")
  );
  if (problems.length) process.exitCode = 1;
}

async function soak(kind: "browse" | "seatmap") {
  const workers = Number(arg("workers", "50"));
  const seconds = Number(arg("seconds", "60"));
  let paths: string[];
  if (kind === "seatmap") {
    paths = [`/shows/${(await freshShow()).showId}/seats`];
  } else {
    const slug = (await json<{ slug: string }[]>("/cinemas"))[0].slug;
    paths = ["/movies", "/cinemas", `/cinemas/${slug}/showtimes`];
  }
  console.log(`\n  ${kind}: ${workers} workers for ${seconds}s against ${paths.join(", ")}\n`);
  console.log("   time   req/s   errors   p95 this second");

  const all: Result[] = [];
  let second: Result[] = [];
  const start = Date.now();
  const end = start + seconds * 1000;
  const ticker = setInterval(() => {
    const s = second;
    second = [];
    const errors = s.filter((r) => r.status === 0 || r.status >= 500).length;
    const p95 = pct(s.map((r) => r.ms).sort((a, b) => a - b), 95);
    const t = Math.round((Date.now() - start) / 1000);
    console.log(
      `   ${String(t).padStart(3)}s  ${String(s.length).padStart(6)}  ${String(errors).padStart(7)}${errors ? " !" : "  "}  ${p95.toFixed(0)} ms`
    );
  }, 1000);

  await Promise.all(
    Array.from({ length: workers }, async (_, w) => {
      for (let i = w; Date.now() < end; i++) {
        const r = await call(paths[i % paths.length]);
        all.push(r);
        second.push(r);
      }
    })
  );
  clearInterval(ticker);

  const elapsed = (Date.now() - start) / 1000;
  const errors = all.filter((r) => r.status === 0 || r.status >= 500).length;
  console.log(`\n   ── summary ──────────────────────────────────`);
  printStatuses(all);
  console.log(`   ${"requests".padEnd(26)} ${all.length}`);
  console.log(`   ${"throughput".padEnd(26)} ${(all.length / elapsed).toFixed(1)} req/s`);
  console.log(`   ${latencyLine(all.map((r) => r.ms))}`);
  printServers(all);
  verdict(
    errors === 0,
    errors === 0 ? "no failed requests" : `${errors} failed requests (${((errors / all.length) * 100).toFixed(2)}%)`
  );
}

(mode === "contended" || mode === "spread" ? reservationBurst(mode) : soak(mode)).catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
