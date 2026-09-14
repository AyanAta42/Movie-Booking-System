export type Movie = {
  id: string;
  slug: string;
  title: string;
  runtimeMinutes: number;
  certification: string;
  genres: string[];
  releaseDate: string;
  posterUrl: string | null;
};

export type Cinema = {
  id: string;
  slug: string;
  name: string;
  city: string;
  screenCount: number;
};

export type Show = {
  id: string;
  /// Mongo `_id` as a hex string. Present on every show so one can be passed
  /// around without the film it belongs to going missing.
  movieId: string;
  startsAt: string;
  endsAt: string;
  screen: string;
  format: string;
  /// Integer minor units. Converted to a decimal only by the price formatter.
  priceCents: number;
};

export type MovieShowtimes = {
  movie: Movie;
  shows: Show[];
};

export type Showtimes = {
  cinema: Omit<Cinema, "screenCount">;
  date: string;
  dates: string[];
  movies: MovieShowtimes[];
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    // The API sends a human-readable `message` on 4xx, and the browse page
    // renders it. Falling back to the bare status matters for 5xx, where the
    // body is deliberately opaque.
    const detail = await res
      .json()
      .then((body) => (typeof body?.message === "string" ? body.message : null))
      .catch(() => null);
    throw new Error(detail ?? `GET ${path} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchMovies(): Promise<Movie[]> {
  return get<Movie[]>("/movies");
}

export function fetchCinemas(): Promise<Cinema[]> {
  return get<Cinema[]>("/cinemas");
}

/// `date` omitted lets the API pick the first day it has showings for, which
/// avoids the client having to guess a date before it knows the schedule.
export function fetchShowtimes(cinemaSlug: string, date?: string): Promise<Showtimes> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return get<Showtimes>(`/cinemas/${encodeURIComponent(cinemaSlug)}/showtimes${query}`);
}
