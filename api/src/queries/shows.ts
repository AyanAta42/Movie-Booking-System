import { prisma } from "../db/postgres";
import { BadRequestError, NotFoundError } from "../errors";
import { findMoviesByIds, type MovieListItem } from "./movies";

/// One showing, flattened for the wire. `screen` is denormalised down to its
/// name because that is the only part of a screen a browsing client can use —
/// seat geometry belongs to the seat map, not the listing.
export type ShowListItem = {
  id: string;
  /// The Mongo `_id` as a 24-char hex string, carried on every show even though
  /// the grouped listing already states it once per film. It is redundant here
  /// and deliberately so: a show handed around on its own — a seat map reached
  /// by showId, a reservation, an order line — must still be able to name its
  /// film without its enclosing group, and this is the only key that can do it.
  movieId: string;
  startsAt: string;
  endsAt: string;
  screen: string;
  format: string;
  /// Integer minor units, as everywhere else. Formatted for display only at
  /// the very edge, in the browser.
  priceCents: number;
};

/// One film playing at one cinema on one day, with every showing of it.
export type MovieShowtimes = {
  movie: MovieListItem;
  shows: ShowListItem[];
};

export type ShowtimesResult = {
  cinema: { id: string; slug: string; name: string; city: string };
  /// The local calendar day being listed, `YYYY-MM-DD`.
  date: string;
  /// Every day this cinema has showings for, so the client can render a date
  /// picker without a second round trip.
  dates: string[];
  movies: MovieShowtimes[];
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/// Day bucketing happens in the API process's local timezone, which is the same
/// timezone the seed wrote showtimes in, so "today" means the same thing on both
/// sides. A real deployment would carry a timezone per cinema and bucket by
/// that — a London and a Birmingham listing genuinely can disagree about which
/// day a 00:30 screening belongs to. Until cinemas span timezones, the point of
/// doing it here rather than in SQL is that the rule lives in exactly one place.
function localDayBounds(date: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number);
  return { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1) };
}

function localDateKey(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/// Read path: the showtimes listing for one cinema on one day.
///
/// Three queries, deliberately: the cinema, the set of days it has shows for,
/// and the shows themselves. The alternative — one fat query returning every
/// show at the cinema and filtering in memory — reads more cleanly at 84 rows
/// and falls over at 84,000.
export async function listShowtimes(
  cinemaSlug: string,
  requestedDate?: string
): Promise<ShowtimesResult> {
  if (requestedDate !== undefined && !DATE_PATTERN.test(requestedDate)) {
    throw new BadRequestError(`date must be formatted YYYY-MM-DD, received "${requestedDate}"`);
  }

  const cinema = await prisma.cinema.findUnique({
    where: { slug: cinemaSlug },
    select: { id: true, slug: true, name: true, city: true },
  });
  if (!cinema) {
    throw new NotFoundError(`No cinema with slug "${cinemaSlug}"`);
  }

  // One column, ordered, so the date picker is driven by what actually exists
  // rather than by a hardcoded seven-day window the seed might disagree with.
  const starts = await prisma.show.findMany({
    where: { screen: { cinemaId: cinema.id } },
    select: { startsAt: true },
    orderBy: { startsAt: "asc" },
  });
  const dates = [...new Set(starts.map((s) => localDateKey(s.startsAt)))];

  // A cinema with no shows is a real state — a new site, or one between
  // schedules — and is empty, not an error.
  if (dates.length === 0) {
    return { cinema, date: requestedDate ?? localDateKey(new Date()), dates: [], movies: [] };
  }

  const date = requestedDate ?? dates[0];
  const { start, end } = localDayBounds(date);
  // Catches the dates that match the pattern but do not exist: `2026-02-31`
  // silently rolls forward into March, and would otherwise list the wrong day.
  if (localDateKey(start) !== date) {
    throw new BadRequestError(`"${date}" is not a real calendar date`);
  }

  const shows = await prisma.show.findMany({
    where: { screen: { cinemaId: cinema.id }, startsAt: { gte: start, lt: end } },
    select: {
      id: true,
      movieId: true,
      startsAt: true,
      endsAt: true,
      format: true,
      priceCents: true,
      screen: { select: { name: true } },
    },
    orderBy: [{ startsAt: "asc" }, { screen: { name: "asc" } }],
  });

  const catalog = await findMoviesByIds(shows.map((s) => s.movieId));

  // Group by film, preserving the start-time ordering above within each group.
  // A show whose movieId resolves to nothing is skipped rather than rendered
  // titleless: the join is application-enforced, so a dangling id must degrade
  // to one missing film instead of a broken page.
  const grouped = new Map<string, MovieShowtimes>();
  for (const s of shows) {
    const movie = catalog.get(s.movieId);
    if (!movie) continue;

    let entry = grouped.get(s.movieId);
    if (!entry) {
      entry = { movie, shows: [] };
      grouped.set(s.movieId, entry);
    }

    entry.shows.push({
      id: s.id,
      movieId: s.movieId,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      screen: s.screen.name,
      format: s.format,
      priceCents: s.priceCents,
    });
  }

  // Alphabetical. A day's schedule at one cinema is scanned by title, unlike
  // the catalog grid, which is a "what's new" view and sorts by release date.
  const movies = [...grouped.values()].sort((a, b) => a.movie.title.localeCompare(b.movie.title));

  return { cinema, date, dates, movies };
}
