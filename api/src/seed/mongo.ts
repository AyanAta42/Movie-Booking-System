import { connectMongo, disconnectMongo } from "../db/mongo";
import { MovieModel } from "../models/movie";

// Catalog seed. Runs BEFORE the Postgres seed, because Postgres shows reference
// Mongo movie _ids and there is no foreign key to fall back on.

const MOVIES = [
  {
    slug: "dune-part-two",
    title: "Dune: Part Two",
    synopsis:
      "Paul Atreides unites with the Fremen to wage war against the House Harkonnen, torn between the love of his life and the fate of the universe.",
    runtimeMinutes: 166,
    certification: "12A",
    genres: ["Sci-Fi", "Adventure"],
    releaseDate: new Date("2024-03-01"),
    director: "Denis Villeneuve",
    cast: [
      { name: "Timothée Chalamet", role: "Paul Atreides" },
      { name: "Zendaya", role: "Chani" },
      { name: "Rebecca Ferguson", role: "Lady Jessica" },
    ],
    formats: ["2D", "IMAX"],
  },
  {
    slug: "oppenheimer",
    title: "Oppenheimer",
    synopsis:
      "The story of J. Robert Oppenheimer and his role in the development of the atomic bomb during the Second World War.",
    runtimeMinutes: 180,
    certification: "15",
    genres: ["Drama", "History"],
    releaseDate: new Date("2023-07-21"),
    director: "Christopher Nolan",
    cast: [
      { name: "Cillian Murphy", role: "J. Robert Oppenheimer" },
      { name: "Emily Blunt", role: "Katherine Oppenheimer" },
    ],
    formats: ["2D", "IMAX"],
  },
  {
    slug: "the-grand-budapest-hotel",
    title: "The Grand Budapest Hotel",
    synopsis:
      "A legendary concierge and his most trusted lobby boy become entangled in the theft of a priceless Renaissance painting.",
    runtimeMinutes: 99,
    certification: "15",
    genres: ["Comedy", "Drama"],
    releaseDate: new Date("2014-03-07"),
    director: "Wes Anderson",
    cast: [
      { name: "Ralph Fiennes", role: "M. Gustave" },
      { name: "Tony Revolori", role: "Zero Moustafa" },
    ],
    formats: ["2D"],
  },
  {
    slug: "spirited-away",
    title: "Spirited Away",
    synopsis:
      "A ten-year-old girl wanders into a world of spirits and must find a way to free herself and her parents.",
    runtimeMinutes: 125,
    certification: "PG",
    genres: ["Animation", "Fantasy"],
    releaseDate: new Date("2003-09-12"),
    director: "Hayao Miyazaki",
    cast: [{ name: "Rumi Hiiragi", role: "Chihiro" }],
    formats: ["2D"],
  },
  {
    slug: "blade-runner-2049",
    title: "Blade Runner 2049",
    synopsis:
      "A young blade runner uncovers a secret with the potential to plunge what is left of society into chaos.",
    runtimeMinutes: 164,
    certification: "15",
    genres: ["Sci-Fi", "Thriller"],
    releaseDate: new Date("2017-10-05"),
    director: "Denis Villeneuve",
    cast: [
      { name: "Ryan Gosling", role: "K" },
      { name: "Harrison Ford", role: "Rick Deckard" },
    ],
    formats: ["2D", "IMAX"],
  },
  {
    slug: "parasite",
    title: "Parasite",
    synopsis:
      "Greed and class discrimination threaten the newly formed symbiotic relationship between a wealthy family and a destitute clan.",
    runtimeMinutes: 132,
    certification: "15",
    genres: ["Thriller", "Drama"],
    releaseDate: new Date("2020-02-07"),
    director: "Bong Joon-ho",
    cast: [{ name: "Song Kang-ho", role: "Ki-taek" }],
    formats: ["2D"],
  },
  {
    slug: "everything-everywhere-all-at-once",
    title: "Everything Everywhere All at Once",
    synopsis:
      "An ageing Chinese immigrant is swept up in an insane adventure in which she alone can save existence by exploring other universes.",
    runtimeMinutes: 139,
    certification: "15",
    genres: ["Action", "Comedy", "Sci-Fi"],
    releaseDate: new Date("2022-05-13"),
    director: "Daniels",
    cast: [{ name: "Michelle Yeoh", role: "Evelyn Wang" }],
    formats: ["2D"],
  },
  {
    slug: "past-lives",
    title: "Past Lives",
    synopsis:
      "Two childhood friends are reunited in New York for one fateful week, confronting notions of destiny and the lives they did not live.",
    runtimeMinutes: 105,
    certification: "12A",
    genres: ["Drama", "Romance"],
    releaseDate: new Date("2023-09-08"),
    director: "Celine Song",
    cast: [{ name: "Greta Lee", role: "Nora" }],
    formats: ["2D"],
  },
];

async function main() {
  await connectMongo();

  // Idempotent: upsert by slug rather than dropping the collection, so re-running
  // the seed does not invalidate the movieIds that Postgres shows point at.
  for (const movie of MOVIES) {
    await MovieModel.updateOne({ slug: movie.slug }, { $set: movie }, { upsert: true });
  }

  const count = await MovieModel.countDocuments();
  console.log(`[seed:mongo] ${MOVIES.length} movies upserted, ${count} total in catalog`);
}

main()
  .catch((err) => {
    console.error("[seed:mongo] failed", err);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
