import { Prisma } from "@prisma/client";
import { prisma } from "../db/postgres";
import {
  BadRequestError,
  ConflictError,
  isSaturationCode,
  NotFoundError,
  ServiceUnavailableError,
} from "../errors";
import { getReservation, type Reservation } from "../queries/reservations";

/// How long a hold survives without being confirmed.
export const HOLD_MINUTES = 10;

/// A cap, so one caller cannot claim an entire screen in one request.
const MAX_SEATS = 10;

export type ReserveInput = {
  userId: string;
  showId: string;
  seatIds: string[];
  idempotencyKey: string;
};

/// Under a burst, most callers are queueing to start a transaction rather than
/// doing work. `maxWait` is how long they will queue before giving up; the
/// default 2s turns a survivable queue into a wall of failures. `timeout` caps
/// how long one claim may hold its locks, so a stuck transaction cannot block
/// everyone behind it indefinitely.
export const TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 } as const;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function asHttpIfSaturated(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && isSaturationCode(err.code)) {
    return new ServiceUnavailableError("Too many reservations in flight, please retry");
  }
  return err;
}

/// Place a time-boxed hold over a set of seats at one show.
///
/// The correctness argument, in one place:
///
/// 1. Every seat already has a `show_seats` row. Claiming is an UPDATE of an
///    existing row, never an INSERT, so there is no race to create one.
/// 2. The claim is a single conditional UPDATE guarded on `status = 'AVAILABLE'`.
///    Postgres evaluates that predicate while holding the row lock, so of N
///    concurrent claims on one seat exactly one sees AVAILABLE and updates it.
/// 3. The statement reports how many rows it changed. If that is not every seat
///    asked for, somebody else won at least one, and the whole transaction rolls
///    back — a reservation is all-or-nothing, never partially granted.
/// 4. `unique(show_id, seat_id)` underneath it all means even a bug in the above
///    cannot produce two live claims on one seat.
///
/// READ COMMITTED (the default) is sufficient. The guard is re-checked after the
/// row lock is acquired, so the classic lost-update window does not exist here.
/// SERIALIZABLE would add retry-on-40001 for no gain.
export async function reserve(input: ReserveInput): Promise<Reservation> {
  const { userId, showId, idempotencyKey } = input;

  // De-duplicate: asking for the same seat twice would make the affected-count
  // check below fail for a reason that is not contention.
  const seatIds = [...new Set(input.seatIds)];

  if (seatIds.length === 0) throw new BadRequestError("At least one seat is required");
  if (seatIds.length > MAX_SEATS) {
    throw new BadRequestError(`At most ${MAX_SEATS} seats per reservation`);
  }
  if (!idempotencyKey) throw new BadRequestError("idempotencyKey is required");

  // Distinguish "that seat is not part of this show" (a client bug, 400) from
  // "that seat is taken" (contention, 409). Without this the affected-count
  // check reports both as a conflict and the caller cannot tell them apart.
  const present = await prisma.showSeat.count({ where: { showId, seatId: { in: seatIds } } });
  if (present !== seatIds.length) {
    const show = await prisma.show.findUnique({ where: { id: showId }, select: { id: true } });
    if (!show) throw new NotFoundError(`No show with id "${showId}"`);
    throw new BadRequestError("One or more seats do not belong to this show");
  }

  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);

  try {
    const holdId = await prisma.$transaction(async (tx) => {
      
      // Expired Holds let go of their seats
      await tx.$executeRaw`
        UPDATE show_seats ss
        SET status = 'AVAILABLE', hold_id = NULL, version = ss.version + 1
        WHERE ss.show_id = ${showId}::uuid
          AND ss.status = 'HELD'
          AND ss.hold_id IN (
            SELECT h.id FROM holds h
            WHERE h.show_id = ${showId}::uuid
              AND h.status = 'ACTIVE'
              AND h.expires_at <= now()
          )
      `;

      // Clean up manually - change all active holds that have expired to expired
      await tx.$executeRaw`
        UPDATE holds
        SET status = 'EXPIRED'
        WHERE show_id = ${showId}::uuid AND status = 'ACTIVE' AND expires_at <= now()
      `;

      // Create Hold
      const hold = await tx.hold.create({
        data: { userId, showId, expiresAt, idempotencyKey },
        select: { id: true },
      });

      // Lock each one, check it's free, take it
      //
      // The CTE takes the row locks in a deterministic order (`ORDER BY seat_id`
      // with FOR UPDATE) before anything is written. Without that, two callers
      // requesting overlapping seat sets can each lock one row and wait on the
      // other's — a genuine deadlock that a single-seat test never reveals,
      // because Postgres locks rows in scan order, not in the order of the IN
      // list. Ordering the locks means everyone queues the same way instead.
      const claimed = await tx.$executeRaw`
        WITH target AS (
          SELECT ss.id
          FROM show_seats ss
          WHERE ss.show_id = ${showId}::uuid
            AND ss.seat_id = ANY(${seatIds}::uuid[])
            AND ss.status = 'AVAILABLE'
          ORDER BY ss.seat_id
          FOR UPDATE
        )
        UPDATE show_seats
        SET status = 'HELD', hold_id = ${hold.id}::uuid, version = version + 1
        WHERE id IN (SELECT id FROM target)
      `;

      // All-or-nothing. Throwing rolls the transaction back, which releases the
      // seats this caller did win and deletes the hold.
      if (claimed !== seatIds.length) {
        throw new ConflictError(
          `Only ${claimed} of ${seatIds.length} seats were still available`
        );
      }

      return hold.id;
    }, TX_OPTIONS);

    return await getReservation(holdId, userId);
  } catch (err) {
    // Idempotent replay. Two requests with the same key race to insert; the
    // loser trips unique(user_id, idempotency_key) and is handed the hold the
    // winner created. Checking for an existing hold *before* inserting would
    // leave a window where both callers see nothing and both proceed.
    if (isUniqueViolation(err)) {
      const existing = await prisma.hold.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: { id: true },
      });
      if (existing) return getReservation(existing.id, userId);
    }
    throw asHttpIfSaturated(err);
  }
}
