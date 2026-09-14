import type { Movie } from "./api";
import { posterGradient, runtimeLabel } from "./format";

/// The poster block, sized by its container so the same component works as a
/// full card in the catalog grid and as a thumbnail beside a list of showtimes.
///
/// `decorative` drops the no-poster fallback title. At thumbnail width a long
/// title clips ("Oppenheime"), and in the showtimes list it would only be
/// repeating the heading sitting immediately beside it.
export function Poster({ movie, decorative = false }: { movie: Movie; decorative?: boolean }) {
  return (
    <div
      className="flex aspect-[2/3] items-end overflow-hidden rounded-lg border border-neutral-800 p-4"
      style={{ background: posterGradient(movie.slug) }}
      aria-hidden={decorative || undefined}
    >
      {movie.posterUrl ? (
        <img src={movie.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        !decorative && <span className="text-sm font-medium text-neutral-300">{movie.title}</span>
      )}
    </div>
  );
}

export function certificationLabel(movie: Movie) {
  const year = new Date(movie.releaseDate).getFullYear();
  return `${movie.certification} · ${runtimeLabel(movie.runtimeMinutes)} · ${year}`;
}

export default function MovieCard({ movie }: { movie: Movie }) {
  return (
    <article className="group">
      <Poster movie={movie} />
      <h2 className="mt-3 text-sm font-medium leading-snug">{movie.title}</h2>
      <p className="mt-1 text-xs text-neutral-400">{certificationLabel(movie)}</p>
      <p className="mt-0.5 text-xs text-neutral-500">{movie.genres.join(", ")}</p>
    </article>
  );
}
