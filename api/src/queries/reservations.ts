import { prisma } from "../db/postgres";
import { NotFoundError } from "../errors";

export type ReservationSeat = {
  label: string;
  priceCents: number;
};

export type Reservation = {
  id: string;
  showId: string;
  status: "ACTIVE" | "CONFIRMED" | "EXPIRED" | "CANCELLED";
  /// Null once the hold is confirmed — a booking does not expire.
  expiresAt: string | null;
  /// Server-computed, so a client cannot be wrong about how long it has left.
  /// Zero for anything that is no longer an active hold.
  secondsRemaining: number;
  show: {
    startsAt: string;
    format: string;
    screen: string;
    cinema: string;
  };
  seats: ReservationSeat[];
  totalCents: number;
};

/// Reads one reservation, scoped to its owner.
///
/// The `userId` filter is the whole access control story for now: another device
/// asking for this id gets a 404, not somebody else's seats. It is a filter on
/// the query rather than a check after the fact, so there is no path where the
/// row is loaded and the check is forgotten.
export async function getReservation(holdId: string, userId: string): Promise<Reservation> {
  const hold = await prisma.hold.findFirst({
    where: { id: holdId, userId },
    select: {
      id: true,
      showId: true,
      status: true,
      expiresAt: true,
      show: {
        select: {
          startsAt: true,
          format: true,
          screen: { select: { name: true, cinema: { select: { name: true } } } },
        },
      },
      showSeats: {
        select: { priceCents: true, seat: { select: { rowLabel: true, number: true } } },
        orderBy: [{ seat: { gridRow: "asc" } }, { seat: { gridCol: "asc" } }],
      },
    },
  });
  if (!hold) throw new NotFoundError(`No reservation with id "${holdId}"`);

  const seats = hold.showSeats.map((s) => ({
    label: `${s.seat.rowLabel}${s.seat.number}`,
    priceCents: s.priceCents,
  }));

  const active = hold.status === "ACTIVE";
  const msLeft = hold.expiresAt.getTime() - Date.now();

  return {
    id: hold.id,
    showId: hold.showId,
    status: hold.status,
    expiresAt: hold.status === "CONFIRMED" ? null : hold.expiresAt.toISOString(),
    secondsRemaining: active && msLeft > 0 ? Math.floor(msLeft / 1000) : 0,
    show: {
      startsAt: hold.show.startsAt.toISOString(),
      format: hold.show.format,
      screen: hold.show.screen.name,
      cinema: hold.show.screen.cinema.name,
    },
    seats,
    totalCents: seats.reduce((sum, s) => sum + s.priceCents, 0),
  };
}
