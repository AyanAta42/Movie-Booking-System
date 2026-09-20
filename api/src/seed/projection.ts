import { connectMongo, disconnectMongo } from "../db/mongo";
import { disconnectPostgres, prisma } from "../db/postgres";
import { CinemaModel, ShowtimeModel } from "../models/catalog";

// Projects the schedule from Postgres (the owner) into Mongo (browsing's read
// model). Run after the Postgres seed: `npm run seed` does it for you.
//
// One direction only — Postgres to Mongo, never back. Today this runs as a
// batch job after seeding. When shows can be scheduled while the system is
// live, the same mapping moves into an event consumer: booking publishes
// "show scheduled", browsing applies it. The mapping below does not change.

async function main() {
  await connectMongo();

  const cinemas = await prisma.cinema.findMany({
    select: { id: true, slug: true, name: true, city: true, _count: { select: { screens: true } } },
  });

  const shows = await prisma.show.findMany({
    select: {
      id: true,
      movieId: true,
      startsAt: true,
      endsAt: true,
      format: true,
      priceCents: true,
      screen: { select: { name: true, cinemaId: true } },
    },
  });

  // Replaced wholesale. Mongo standalone has no multi-document transaction, so
  // a reader could briefly see an empty listing mid-rebuild — acceptable for a
  // seed, and the reason this becomes per-event upserts once it runs live.
  await CinemaModel.deleteMany({});
  await CinemaModel.insertMany(
    cinemas.map((c) => ({
      _id: c.id,
      slug: c.slug,
      name: c.name,
      city: c.city,
      screenCount: c._count.screens,
    }))
  );

  await ShowtimeModel.deleteMany({});
  await ShowtimeModel.insertMany(
    shows.map((s) => ({
      _id: s.id,
      cinemaId: s.screen.cinemaId,
      movieId: s.movieId,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      screen: s.screen.name,
      format: s.format,
      priceCents: s.priceCents,
    }))
  );

  // Builds the (cinemaId, startsAt) index if it is not there yet.
  await ShowtimeModel.syncIndexes();

  console.log(`[seed:projection] ${cinemas.length} cinemas, ${shows.length} showtimes -> Mongo`);
}

main()
  .catch((err) => {
    console.error("[seed:projection] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
    await disconnectPostgres();
  });
