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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchMovies(): Promise<Movie[]> {
  return get<Movie[]>("/movies");
}
