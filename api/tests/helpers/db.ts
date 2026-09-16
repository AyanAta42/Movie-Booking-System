import { prisma } from "../../src/db/postgres";

export { prisma };

export type SeatRef = { showSeatId: string; seatId: string; label: string };

let cachedShowId: string | null = null;

/// The show every test works on.
///
/// One show, reset between cases, rather than a fresh show each time: shows are
/// independent, so reusing one proves nothing less, and `resetShow` is far
/// cheaper than re-seeding. Test files run sequentially (see vitest.config.ts),
/// so nothing else is touching it.
export async function testShow(): Promise<string> {
  if (cachedShowId) return cachedShowId;
  const show = await prisma.show.findFirst({ orderBy: { startsAt: "asc" }, select: { id: true } });
  if (!show) throw new Error("No shows in the test database — seeding did not run");
  cachedShowId = show.id;
  return show.id;
}

/// Back to a clean slate: every seat available, every hold gone.
///
/// Seats are detached before the holds are deleted. `show_seats.hold_id` is
/// ON DELETE RESTRICT, so deleting a hold that still owns seats fails — the same
/// constraint that stops production from corrupting inventory stops this from
/// taking a shortcut.
export async function resetShow(showId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE show_seats SET status = 'AVAILABLE', hold_id = NULL, version = 0
    WHERE show_id = ${showId}::uuid
  `;
  await prisma.$executeRaw`DELETE FROM holds WHERE show_id = ${showId}::uuid`;
}

/// The first `count` seats of a show, in seat-map order.
export async function seatsOf(showId: string, count: number): Promise<SeatRef[]> {
  const rows = await prisma.showSeat.findMany({
    where: { showId },
    select: { id: true, seatId: true, seat: { select: { rowLabel: true, number: true } } },
    orderBy: [{ seat: { gridRow: "asc" } }, { seat: { gridCol: "asc" } }],
    take: count,
  });
  return rows.map((r) => ({
    showSeatId: r.id,
    seatId: r.seatId,
    label: `${r.seat.rowLabel}${r.seat.number}`,
  }));
}

export async function seatStatus(showId: string, seatId: string) {
  const row = await prisma.showSeat.findFirst({
    where: { showId, seatId },
    select: { status: true, holdId: true, version: true },
  });
  if (!row) throw new Error(`no show_seat for seat ${seatId}`);
  return row;
}

export async function countByStatus(showId: string, status: "AVAILABLE" | "HELD" | "BOOKED") {
  return prisma.showSeat.count({ where: { showId, status } });
}

/// Drag a hold's expiry into the past, the way ten real minutes would.
export async function forceExpire(holdId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE holds SET expires_at = now() - interval '1 second' WHERE id = ${holdId}::uuid
  `;
}

type Violation = { rule: string; count: number; detail: string };

/// The invariants. Every one of these must return zero rows at every instant —
/// not just at rest, and not just on the happy path.
///
/// This is the highest-value assertion in the suite. Response codes only tell
/// you what a caller was told; these tell you whether the data underneath is
/// still coherent. Run it after anything concurrent.
const RULES: { rule: string; detail: string; sql: () => Promise<unknown[]> }[] = [
  {
    rule: "held-seat-has-hold",
    detail: "a seat is HELD but points at no hold",
    sql: () => prisma.$queryRaw`SELECT id FROM show_seats WHERE status = 'HELD' AND hold_id IS NULL`,
  },
  {
    rule: "available-seat-has-no-hold",
    detail: "a seat is AVAILABLE but still points at a hold",
    sql: () =>
      prisma.$queryRaw`SELECT id FROM show_seats WHERE status = 'AVAILABLE' AND hold_id IS NOT NULL`,
  },
  {
    rule: "booked-seat-is-confirmed",
    detail: "a seat is BOOKED but its hold is not CONFIRMED",
    sql: () => prisma.$queryRaw`
      SELECT ss.id FROM show_seats ss
      LEFT JOIN holds h ON h.id = ss.hold_id
      WHERE ss.status = 'BOOKED' AND (h.id IS NULL OR h.status <> 'CONFIRMED')
    `,
  },
  {
    rule: "dead-hold-owns-nothing",
    detail: "an EXPIRED or CANCELLED hold still holds seats",
    sql: () => prisma.$queryRaw`
      SELECT ss.id FROM show_seats ss
      JOIN holds h ON h.id = ss.hold_id
      WHERE h.status IN ('EXPIRED', 'CANCELLED') AND ss.status = 'HELD'
    `,
  },
  {
    rule: "confirmed-hold-owns-seats",
    detail: "a CONFIRMED hold has no seats, or seats that are not BOOKED",
    sql: () => prisma.$queryRaw`
      SELECT h.id FROM holds h
      WHERE h.status = 'CONFIRMED'
        AND NOT EXISTS (
          SELECT 1 FROM show_seats ss WHERE ss.hold_id = h.id AND ss.status = 'BOOKED'
        )
    `,
  },
];

export async function invariantViolations(): Promise<Violation[]> {
  const found: Violation[] = [];
  for (const r of RULES) {
    const rows = await r.sql();
    if (rows.length > 0) found.push({ rule: r.rule, count: rows.length, detail: r.detail });
  }
  return found;
}
