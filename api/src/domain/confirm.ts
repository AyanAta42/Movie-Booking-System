import { Prisma } from "@prisma/client";
import { prisma } from "../db/postgres";
import {
  ConflictError,
  GoneError,
  isSaturationCode,
  NotFoundError,
  ServiceUnavailableError,
} from "../errors";
import { getReservation, type Reservation } from "../queries/reservations";
import { TX_OPTIONS } from "./reserve";

/// Turn a hold into a booking. There is no payment step, so this is the
/// irreversible one: once seats are BOOKED nothing releases them.
///
/// The ordering inside the transaction is the whole design:
///
/// 1. Flip the hold ACTIVE -> CONFIRMED with a conditional UPDATE. That single
///    statement is the mutual exclusion — of N concurrent confirms of one hold,
///    exactly one changes a row. It also guards `expires_at > now()`, so a
///    lapsed hold can never be confirmed.
/// 2. Only then book the seats. Doing it in this order matters: `reserve()` only
///    reclaims seats from holds that are still ACTIVE, so promoting the hold to
///    CONFIRMED first makes it invisible to reclaim. If the hold's ten minutes
///    elapse between the two statements, the seats are already protected.
///
/// The two guards are complementary rather than overlapping: reclaim requires
/// `expires_at <= now()`, confirm requires `expires_at > now()`. No instant
/// satisfies both, so there is no window where a seat could be confirmed and
/// stolen at the same time.
export async function confirm(holdId: string, userId: string): Promise<Reservation> {
  try {
    await runConfirm(holdId, userId);
  } catch (err) {
    // Same reasoning as reserve(): a transaction that never started is a
    // capacity problem the caller can retry, not a bug.
    if (err instanceof Prisma.PrismaClientKnownRequestError && isSaturationCode(err.code)) {
      throw new ServiceUnavailableError("Too many confirmations in flight, please retry");
    }
    throw err;
  }

  return getReservation(holdId, userId);
}

async function runConfirm(holdId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const promoted = await tx.$executeRaw`
      UPDATE holds
      SET status = 'CONFIRMED'
      WHERE id = ${holdId}::uuid
        AND user_id = ${userId}::uuid
        AND status = 'ACTIVE'
        AND expires_at > now()
    `;

    if (promoted === 0) {
      // Nothing changed. Read the row to say why, rather than returning a
      // blanket conflict the client cannot act on.
      const hold = await tx.hold.findFirst({
        where: { id: holdId, userId },
        select: { status: true, expiresAt: true },
      });

      if (!hold) throw new NotFoundError(`No reservation with id "${holdId}"`);

      // Already confirmed. Treat a repeat confirm as success — the caller's
      // intent is satisfied, and a double-tap on the button should not read as
      // an error. This is what makes confirm safe to retry.
      if (hold.status === "CONFIRMED") return;

      if (hold.status === "ACTIVE" && hold.expiresAt.getTime() <= Date.now()) {
        throw new GoneError("This reservation expired before it was confirmed");
      }
      throw new GoneError(`This reservation is ${hold.status.toLowerCase()}`);
    }

    const booked = await tx.$executeRaw`
      UPDATE show_seats
      SET status = 'BOOKED', version = version + 1
      WHERE hold_id = ${holdId}::uuid AND status = 'HELD'
    `;

    // The hold was ACTIVE and unexpired, so its seats should all still be HELD
    // by it. Zero means the world changed underneath us in a way this code does
    // not model — fail the transaction rather than confirm an empty booking.
    if (booked === 0) {
      throw new ConflictError("This reservation no longer holds any seats");
    }
  }, TX_OPTIONS);
}
