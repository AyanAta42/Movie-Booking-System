import { prisma } from "../db/postgres";
import { NotFoundError } from "../errors";

export type SeatMapSeat = {
  /// The show_seat row id. This is what a reservation claims, not `seatId`.
  id: string;
  seatId: string;
  /// "F12". What the customer reads off the ticket.
  label: string;
  gridRow: number;
  gridCol: number;
  kind: "STANDARD" | "PREMIUM" | "ACCESSIBLE";
  /// Effective status, with expired holds already resolved back to AVAILABLE —
  /// see the note on expiry below.
  status: "AVAILABLE" | "HELD" | "BOOKED";
  /// True when the seat is held by the calling device, so the UI can show "yours"
  /// rather than "someone else's". Never true for BOOKED seats of other users.
  mine: boolean;
  priceCents: number;
};

export type SeatMap = {
  show: {
    id: string;
    startsAt: string;
    format: string;
    screen: string;
    cinema: string;
    movieTitle: string;
  };
  /// Grid extent, so the client can lay out a rectangle without scanning seats.
  rows: number;
  cols: number;
  seats: SeatMapSeat[];
};

export async function getSeatMap(showId: string, userId: string): Promise<SeatMap> {
  const show = await prisma.show.findUnique({
    where: { id: showId },
    select: {
      id: true,
      // Booking's own copy of the title, not a lookup into the Mongo catalog —
      // the booking service reads Postgres and nothing else.
      movieTitle: true,
      startsAt: true,
      format: true,
      screen: { select: { name: true, cinema: { select: { name: true } } } },
    },
  });
  if (!show) throw new NotFoundError(`No show with id "${showId}"`);

  const rows = await prisma.showSeat.findMany({
    where: { showId },
    select: {
      id: true,
      seatId: true,
      status: true,
      priceCents: true,
      seat: { select: { rowLabel: true, number: true, gridRow: true, gridCol: true, kind: true } },
      hold: { select: { userId: true, expiresAt: true, status: true } },
    },
  });

  const now = Date.now();

  const seats: SeatMapSeat[] = rows.map((r) => {
    // Expiry is resolved at read time rather than by a background job. A hold
    // whose expiresAt has passed no longer claims anything, so the seat reads as
    // AVAILABLE here and the reserve path will happily take it. A sweeper would
    // only be tidying up rows, not enforcing this.
    const holdLapsed = r.hold ? r.hold.expiresAt.getTime() <= now : true;
    const effective = r.status === "HELD" && holdLapsed ? "AVAILABLE" : r.status;

    return {
      id: r.id,
      seatId: r.seatId,
      label: `${r.seat.rowLabel}${r.seat.number}`,
      gridRow: r.seat.gridRow,
      gridCol: r.seat.gridCol,
      kind: r.seat.kind,
      status: effective,
      mine: effective !== "AVAILABLE" && r.hold?.userId === userId,
      priceCents: r.priceCents,
    };
  });

  return {
    show: {
      id: show.id,
      startsAt: show.startsAt.toISOString(),
      format: show.format,
      screen: show.screen.name,
      cinema: show.screen.cinema.name,
      movieTitle: show.movieTitle ?? "Unknown film",
    },
    rows: seats.reduce((m, s) => Math.max(m, s.gridRow + 1), 0),
    cols: seats.reduce((m, s) => Math.max(m, s.gridCol + 1), 0),
    seats,
  };
}
