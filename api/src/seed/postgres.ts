import { prisma, disconnectPostgres } from "../db/postgres";
import { connectMongo, disconnectMongo } from "../db/mongo";
import { MovieModel } from "../models/movie";

// Transactional seed: cinemas -> screens -> seats -> shows -> show_seats.
//
// This script reads Mongo to resolve slug -> movieId, which is the polyglot
// join being enforced in application code because no foreign key can exist
// across the two stores. Run `npm run seed:mongo` first.

const CINEMAS = [
  { slug: "odeon-leicester-square", name: "Odeon Luxe Leicester Square", city: "London", screens: 3 },
  { slug: "picturehouse-central", name: "Picturehouse Central", city: "London", screens: 2 },
  { slug: "cineworld-birmingham", name: "Cineworld Birmingham", city: "Birmingham", screens: 3 },
];

// 10 rows x 20 seats = 200 seats per screen, matching the contention target.
const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K"];
const SEATS_PER_ROW = 20;

/// Rows A-B are at the front and cheap-and-cheerful; the back two rows are
/// premium. Two aisle seats per screen are accessible.
function seatKind(rowLabel: string, number: number): "STANDARD" | "PREMIUM" | "ACCESSIBLE" {
  if (rowLabel === "A" && (number === 1 || number === SEATS_PER_ROW)) return "ACCESSIBLE";
  if (rowLabel === "J" || rowLabel === "K") return "PREMIUM";
  return "STANDARD";
}

const SHOW_TIMES = [11, 14, 17, 20]; // local hours
const DAYS_AHEAD = 7;

function priceCentsFor(hour: number, format: string): number {
  // Integer minor units only.
  let cents = hour < 17 ? 895 : 1295;
  if (format === "IMAX") cents += 400;
  return cents;
}

async function resolveMovieIds() {
  await connectMongo();
  const movies = await MovieModel.find({}, "slug title formats").lean();
  if (movies.length === 0) {
    throw new Error("No movies in Mongo. Run `npm run seed:mongo` first.");
  }
  return movies.map((m) => ({
    movieId: String(m._id),
    slug: m.slug,
    title: m.title,
    formats: (m.formats ?? ["2D"]) as string[],
  }));
}

async function main() {
  const movies = await resolveMovieIds();

  // Wiped and rebuilt every run. Safe only because nothing here is real user
  // data yet — once orders exist this becomes a guarded dev-only script.
  // Order matters. show_seats reference holds with onDelete: Restrict, so the
  // seat rows have to go before the holds they point at. Users are deliberately
  // left alone — each device upserts its own on next request.
  await prisma.showSeat.deleteMany();
  await prisma.hold.deleteMany();
  await prisma.show.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.screen.deleteMany();
  await prisma.cinema.deleteMany();

  let screenCount = 0;
  let seatCount = 0;
  let showCount = 0;
  let showSeatCount = 0;

  // Midnight today, local time, as the base for showtimes.
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  let movieCursor = 0;

  for (const cinemaSpec of CINEMAS) {
    const cinema = await prisma.cinema.create({
      data: { slug: cinemaSpec.slug, name: cinemaSpec.name, city: cinemaSpec.city },
    });

    for (let s = 1; s <= cinemaSpec.screens; s++) {
      const screen = await prisma.screen.create({
        data: { cinemaId: cinema.id, name: `Screen ${s}` },
      });
      screenCount++;

      // gridRow/gridCol are stored, not derived: ROWS skips "I" by cinema
      // convention, so the row index cannot be computed from the letter.
      const seatRows = ROWS.flatMap((rowLabel, rowIndex) =>
        Array.from({ length: SEATS_PER_ROW }, (_, i) => ({
          screenId: screen.id,
          rowLabel,
          number: i + 1,
          kind: seatKind(rowLabel, i + 1),
          gridRow: rowIndex,
          gridCol: i,
        }))
      );
      await prisma.seat.createMany({ data: seatRows });
      seatCount += seatRows.length;

      const seats = await prisma.seat.findMany({
        where: { screenId: screen.id },
        select: { id: true },
      });

      for (let day = 0; day < DAYS_AHEAD; day++) {
        for (const hour of SHOW_TIMES) {
          const movie = movies[movieCursor % movies.length];
          movieCursor++;

          const format = movie.formats.includes("IMAX") && s === 1 ? "IMAX" : "2D";

          const startsAt = new Date(base);
          startsAt.setDate(startsAt.getDate() + day);
          startsAt.setHours(hour, 0, 0, 0);

          const endsAt = new Date(startsAt.getTime() + 150 * 60_000);

          const show = await prisma.show.create({
            data: {
              screenId: screen.id,
              movieId: movie.movieId,
              // Copied at scheduling time so the booking service never has to
              // read Mongo to name the film on a seat map.
              movieTitle: movie.title,
              startsAt,
              endsAt,
              priceCents: priceCentsFor(hour, format),
              format,
            },
          });
          showCount++;

          // Materialise one row per seat per showing, up front. "Available" must
          // be a row that can be locked and conditionally updated, not the
          // absence of a row that two concurrent inserts would race to create.
          // Price is captured onto each row here rather than read through from
          // the show at checkout, so a later price change cannot reprice a seat
          // somebody is already holding.
          await prisma.showSeat.createMany({
            data: seats.map((seat) => ({
              showId: show.id,
              seatId: seat.id,
              priceCents: show.priceCents,
            })),
          });
          showSeatCount += seats.length;
        }
      }
    }
  }

  console.log(
    `[seed:postgres] ${CINEMAS.length} cinemas, ${screenCount} screens, ${seatCount} seats, ` +
      `${showCount} shows, ${showSeatCount} show_seats`
  );
}

main()
  .catch((err) => {
    console.error("[seed:postgres] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
    await disconnectPostgres();
  });
