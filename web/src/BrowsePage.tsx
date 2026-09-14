import { useQuery } from "@tanstack/react-query";
import { fetchMovies, type Movie } from "./api";

function runtimeLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// No poster images are seeded, so the card falls back to a deterministic
// gradient derived from the slug. Keeps the seed offline — no external image host.
function posterGradient(slug: string) {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `linear-gradient(145deg, hsl(${hash} 45% 22%), hsl(${(hash + 50) % 360} 40% 12%))`;
}

function MovieCard({ movie }: { movie: Movie }) {
  return (
    <article className="group">
      <div
        className="flex aspect-[2/3] items-end rounded-lg border border-neutral-800 p-4 overflow-hidden"
        style={{ background: posterGradient(movie.slug) }}
      >
        {movie.posterUrl ? (
          <img
            src={movie.posterUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-sm font-medium text-neutral-300">{movie.title}</span>
        )}
      </div>

      <h2 className="mt-3 text-sm font-medium leading-snug">{movie.title}</h2>
      <p className="mt-1 text-xs text-neutral-400">
        {movie.certification} · {runtimeLabel(movie.runtimeMinutes)}
      </p>
      <p className="mt-0.5 text-xs text-neutral-500">{movie.genres.join(", ")}</p>
    </article>
  );
}

export default function BrowsePage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["movies"],
    queryFn: fetchMovies,
  });

  if (isPending) {
    return <p className="text-sm text-neutral-400">Loading films…</p>;
  }

  if (isError) {
    return (
      <p className="text-sm text-red-400">
        Couldn’t load films: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }

  if (data.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        No films in the catalog. Have you run <code className="text-neutral-200">npm run seed</code>?
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {data.map((movie) => (
        <MovieCard key={movie.id} movie={movie} />
      ))}
    </div>
  );
}
