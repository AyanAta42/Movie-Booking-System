import { useQuery } from "@tanstack/react-query";
import { fetchShowtimes, type MovieShowtimes, type Show } from "./api";
import { Poster, certificationLabel } from "./MovieCard";
import { dateLabel, dayLabel, priceLabel, timeLabel } from "./format";

/// One showing. Not a button: reserving a seat is the write path, and it does
/// not exist yet. A clickable tile that led nowhere would be a worse lie than
/// an honestly static one.
function ShowTile({ show }: { show: Show }) {
  return (
    <li className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium tabular-nums text-neutral-100">
          {timeLabel(show.startsAt)}
        </span>
        {show.format !== "2D" && (
          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300">
            {show.format}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-neutral-400">{show.screen}</div>
      <div className="text-xs tabular-nums text-neutral-500">{priceLabel(show.priceCents)}</div>
    </li>
  );
}

function ShowtimesRow({ entry }: { entry: MovieShowtimes }) {
  const { movie, shows } = entry;

  return (
    <article className="flex gap-4 border-b border-neutral-800 py-5 last:border-b-0 sm:gap-5">
      <div className="w-20 shrink-0 sm:w-24">
        <Poster movie={movie} decorative />
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium leading-snug">{movie.title}</h2>
        <p className="mt-1 text-xs text-neutral-400">{certificationLabel(movie)}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{movie.genres.join(", ")}</p>

        <ul className="mt-3 flex flex-wrap gap-2">
          {shows.map((show) => (
            <ShowTile key={show.id} show={show} />
          ))}
        </ul>
      </div>
    </article>
  );
}

function DatePicker({
  dates,
  selected,
  onSelect,
}: {
  dates: string[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="-mx-6 mb-2 overflow-x-auto px-6">
      <div className="flex gap-2">
        {dates.map((date) => {
          const active = date === selected;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              aria-current={active ? "date" : undefined}
              className={`shrink-0 rounded-md border px-3 py-2 text-left transition ${
                active
                  ? "border-neutral-100 bg-neutral-100 text-neutral-900"
                  : "border-neutral-800 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900"
              }`}
            >
              <div className="text-xs font-medium">{dayLabel(date)}</div>
              <div className={`text-[10px] ${active ? "text-neutral-600" : "text-neutral-500"}`}>
                {dateLabel(date)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ShowtimesList({
  cinemaSlug,
  date,
  onDateChange,
}: {
  cinemaSlug: string;
  /// `undefined` until the user picks a day, which lets the API choose the
  /// first day it has showings for rather than the client guessing one.
  date: string | undefined;
  onDateChange: (date: string) => void;
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["showtimes", cinemaSlug, date ?? null],
    queryFn: () => fetchShowtimes(cinemaSlug, date),
    // Keeps the previous day's listing on screen while the next one loads, so
    // switching dates does not flash the whole section back to "Loading".
    placeholderData: (previous) => previous,
  });

  if (isPending) {
    return <p className="text-sm text-neutral-400">Loading showtimes…</p>;
  }

  if (isError) {
    return (
      <p className="text-sm text-red-400">
        Couldn’t load showtimes: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }

  return (
    <section>
      {data.dates.length > 0 && (
        <DatePicker dates={data.dates} selected={data.date} onSelect={onDateChange} />
      )}

      {data.movies.length === 0 ? (
        <p className="py-6 text-sm text-neutral-400">
          Nothing showing at {data.cinema.name} on this date.
        </p>
      ) : (
        <div className="mt-2">
          {data.movies.map((entry) => (
            <ShowtimesRow key={entry.movie.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}
