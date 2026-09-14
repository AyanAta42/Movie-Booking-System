import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCinemas, fetchMovies, type Cinema } from "../lib/api";
import MovieCard from "../components/MovieCard";
import ShowtimesList from "../components/ShowtimesList";

/// `null` means "All cinemas", which shows the catalog rather than a schedule.
/// Showtimes only mean something at a specific cinema — a merged listing across
/// three sites would put two screens called "Screen 1" next to each other with
/// no way to tell them apart.
type Selection = { cinemaSlug: string | null; date: string | undefined };

function CinemaFilter({
  cinemas,
  selected,
  onSelect,
}: {
  cinemas: Cinema[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
}) {
  const options: { slug: string | null; label: string; sub: string }[] = [
    { slug: null, label: "All cinemas", sub: `${cinemas.length} sites` },
    ...cinemas.map((c) => ({
      slug: c.slug,
      label: c.name,
      sub: `${c.city} · ${c.screenCount} screens`,
    })),
  ];

  return (
    <div className="-mx-6 overflow-x-auto px-6 pb-1">
      <div className="flex gap-2" role="group" aria-label="Filter by cinema">
        {options.map((option) => {
          const active = option.slug === selected;
          return (
            <button
              key={option.slug ?? "all"}
              type="button"
              onClick={() => onSelect(option.slug)}
              aria-pressed={active}
              className={`shrink-0 rounded-lg border px-3.5 py-2 text-left transition ${
                active
                  ? "border-neutral-100 bg-neutral-100 text-neutral-900"
                  : "border-neutral-800 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900"
              }`}
            >
              <div className="text-xs font-medium">{option.label}</div>
              <div className={`text-[10px] ${active ? "text-neutral-600" : "text-neutral-500"}`}>
                {option.sub}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MovieGrid() {
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

export default function BrowsePage() {
  const [selection, setSelection] = useState<Selection>({ cinemaSlug: null, date: undefined });

  const cinemas = useQuery({ queryKey: ["cinemas"], queryFn: fetchCinemas });

  return (
    <div className="space-y-6">
      {cinemas.isError ? (
        <p className="text-sm text-red-400">
          Couldn’t load cinemas:{" "}
          {cinemas.error instanceof Error ? cinemas.error.message : "unknown error"}
        </p>
      ) : (
        cinemas.data && (
          <CinemaFilter
            cinemas={cinemas.data}
            selected={selection.cinemaSlug}
            // Switching cinema clears the date: the new cinema may not run
            // shows on the day that was selected, and the API picking its first
            // available day is a better landing state than an empty listing.
            onSelect={(cinemaSlug) => setSelection({ cinemaSlug, date: undefined })}
          />
        )
      )}

      {selection.cinemaSlug === null ? (
        <MovieGrid />
      ) : (
        <ShowtimesList
          cinemaSlug={selection.cinemaSlug}
          date={selection.date}
          onDateChange={(date) => setSelection((prev) => ({ ...prev, date }))}
        />
      )}
    </div>
  );
}
