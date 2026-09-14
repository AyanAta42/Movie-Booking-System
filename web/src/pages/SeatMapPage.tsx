import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, createReservation, fetchSeatMap, type SeatMapSeat } from "../lib/api";
import { priceLabel, timeLabel } from "../lib/format";

const MAX_SEATS = 10;

function seatClasses(seat: SeatMapSeat, selected: boolean) {
  if (selected) return "bg-emerald-400 text-neutral-900 border-emerald-300";
  if (seat.status === "BOOKED") {
    return seat.mine
      ? "bg-sky-900 text-sky-300 border-sky-700 cursor-not-allowed"
      : "bg-neutral-800 text-neutral-600 border-neutral-700 cursor-not-allowed";
  }
  if (seat.status === "HELD") {
    return seat.mine
      ? "bg-amber-900 text-amber-300 border-amber-700 cursor-not-allowed"
      : "bg-neutral-800 text-neutral-600 border-neutral-700 cursor-not-allowed";
  }
  if (seat.kind === "PREMIUM") return "border-violet-700 text-violet-300 hover:bg-violet-950";
  if (seat.kind === "ACCESSIBLE") return "border-sky-700 text-sky-300 hover:bg-sky-950";
  return "border-neutral-700 text-neutral-300 hover:bg-neutral-800";
}

export default function SeatMapPage() {
  const { showId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["seatmap", showId],
    queryFn: () => fetchSeatMap(showId),
    // Seat state is contended and changes under you. Short stale time plus a
    // poll keeps the map roughly honest without pretending it is authoritative —
    // the server decides, and a 409 on submit is the real answer.
    staleTime: 3_000,
    refetchInterval: 5_000,
  });

  // A stable key per selection, so a double-tap on Reserve cannot create two
  // holds. Changing the selection deliberately changes the key.
  const idempotencyKey = useMemo(
    () => (selected.length ? `${showId}:${[...selected].sort().join(",")}` : ""),
    [showId, selected]
  );

  const reserve = useMutation({
    mutationFn: () => createReservation(showId, selected, idempotencyKey),
    onSuccess: (held) => navigate(`/reservations/${held.id}`),
    onError: () => queryClient.invalidateQueries({ queryKey: ["seatmap", showId] }),
  });

  if (isPending) return <p className="text-sm text-neutral-400">Loading seats…</p>;
  if (isError) {
    return (
      <p className="text-sm text-red-400">
        {error instanceof Error ? error.message : "Could not load seats"}
      </p>
    );
  }

  const byPosition = new Map(data.seats.map((s) => [`${s.gridRow}:${s.gridCol}`, s]));
  const selectedSeats = data.seats.filter((s) => selected.includes(s.seatId));
  const total = selectedSeats.reduce((sum, s) => sum + s.priceCents, 0);

  function toggle(seat: SeatMapSeat) {
    if (seat.status !== "AVAILABLE") return;
    setSelected((prev) =>
      prev.includes(seat.seatId)
        ? prev.filter((id) => id !== seat.seatId)
        : prev.length >= MAX_SEATS
          ? prev
          : [...prev, seat.seatId]
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link to="/" className="text-xs text-neutral-400 underline">
          ← All showtimes
        </Link>
        <h1 className="mt-2 text-base font-medium">{data.show.movieTitle}</h1>
        <p className="text-xs text-neutral-400">
          {data.show.cinema} · {data.show.screen} · {data.show.format} ·{" "}
          {timeLabel(data.show.startsAt)}
        </p>
      </div>

      <p className="text-center text-[10px] uppercase tracking-widest text-neutral-600">Screen</p>

      <div className="overflow-x-auto">
        <div className="inline-block space-y-1">
          {Array.from({ length: data.rows }, (_, row) => (
            <div key={row} className="flex gap-1">
              {Array.from({ length: data.cols }, (_, col) => {
                const seat = byPosition.get(`${row}:${col}`);
                if (!seat) return <div key={col} className="h-7 w-7" />;
                const isSelected = selected.includes(seat.seatId);
                return (
                  <button
                    key={col}
                    type="button"
                    onClick={() => toggle(seat)}
                    disabled={seat.status !== "AVAILABLE"}
                    title={`${seat.label} · ${seat.kind} · ${priceLabel(seat.priceCents)}${
                      seat.status === "AVAILABLE" ? "" : ` · ${seat.mine ? "yours" : "taken"}`
                    }`}
                    className={`h-7 w-7 rounded border text-[9px] leading-none ${seatClasses(
                      seat,
                      isSelected
                    )}`}
                  >
                    {seat.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-500">
        <span>standard</span>
        <span className="text-violet-300">premium</span>
        <span className="text-sky-300">accessible</span>
        <span className="text-amber-300">your hold</span>
        <span className="text-neutral-600">taken</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-4">
        <div className="min-w-0 flex-1 text-xs">
          {selectedSeats.length === 0 ? (
            <span className="text-neutral-500">Pick up to {MAX_SEATS} seats.</span>
          ) : (
            <span>
              {selectedSeats.map((s) => s.label).join(", ")} ·{" "}
              <span className="tabular-nums">{priceLabel(total)}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => reserve.mutate()}
          disabled={selected.length === 0 || reserve.isPending}
          className="rounded bg-neutral-100 px-4 py-2 text-xs font-medium text-neutral-900 disabled:opacity-40"
        >
          {reserve.isPending ? "Reserving…" : `Reserve for 10 min`}
        </button>
      </div>

      {reserve.isError && (
        <p className="text-xs text-red-400">
          {reserve.error instanceof ApiError && reserve.error.status === 409
            ? `${reserve.error.message}. Someone else got there first — the map has been refreshed.`
            : reserve.error instanceof Error
              ? reserve.error.message
              : "Could not reserve"}
        </p>
      )}
    </div>
  );
}
