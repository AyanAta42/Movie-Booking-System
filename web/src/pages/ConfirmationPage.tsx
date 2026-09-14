import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, confirmReservation, fetchReservation } from "../lib/api";
import { priceLabel, timeLabel } from "../lib/format";

/// Counts down from the server's `secondsRemaining`. Display only — the server
/// decides whether a hold is still valid, and this hitting zero is a prompt to
/// stop trying, not the thing that expires it.
function useCountdown(fromSeconds: number) {
  const [left, setLeft] = useState(fromSeconds);

  useEffect(() => setLeft(fromSeconds), [fromSeconds]);

  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [left]);

  return left;
}

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ConfirmationPage() {
  const { holdId = "" } = useParams();
  const queryClient = useQueryClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["reservation", holdId],
    queryFn: () => fetchReservation(holdId),
  });

  const left = useCountdown(data?.secondsRemaining ?? 0);

  const confirm = useMutation({
    mutationFn: () => confirmReservation(holdId),
    onSuccess: (updated) => queryClient.setQueryData(["reservation", holdId], updated),
  });

  if (isPending) return <p className="text-sm text-neutral-400">Loading reservation…</p>;
  if (isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-400">
          {error instanceof Error ? error.message : "Could not load reservation"}
        </p>
        <Link to="/" className="text-xs text-neutral-400 underline">
          ← Back to showtimes
        </Link>
      </div>
    );
  }

  const booked = data.status === "CONFIRMED";
  const lapsed = !booked && left <= 0;

  return (
    <div className="max-w-md space-y-5">
      <div>
        <h1 className="text-base font-medium">
          {booked ? "Booking confirmed" : lapsed ? "Reservation expired" : "Confirm your seats"}
        </h1>
        <p className="text-xs text-neutral-400">
          {data.show.cinema} · {data.show.screen} · {data.show.format} ·{" "}
          {timeLabel(data.show.startsAt)}
        </p>
      </div>

      <dl className="space-y-1 border-y border-neutral-800 py-3 text-xs">
        <div className="flex justify-between">
          <dt className="text-neutral-400">Seats</dt>
          <dd>{data.seats.map((s) => s.label).join(", ")}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-neutral-400">Total</dt>
          <dd className="tabular-nums">{priceLabel(data.totalCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-neutral-400">Status</dt>
          <dd>{data.status}</dd>
        </div>
      </dl>

      {booked ? (
        <p className="rounded border border-emerald-800 bg-emerald-950 px-3 py-2 text-xs text-emerald-300">
          These seats are yours. Nothing can take them now.
        </p>
      ) : lapsed ? (
        <p className="rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          The ten minutes ran out and the seats went back on sale.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-neutral-400">
            Held for <span className="tabular-nums text-neutral-100">{clock(left)}</span>
          </p>
          <button
            type="button"
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending}
            className="rounded bg-emerald-400 px-4 py-2 text-xs font-medium text-neutral-900 disabled:opacity-40"
          >
            {confirm.isPending ? "Confirming…" : "Confirm booking"}
          </button>
        </div>
      )}

      {confirm.isError && (
        <p className="text-xs text-red-400">
          {confirm.error instanceof ApiError && confirm.error.status === 410
            ? "This hold lapsed before it was confirmed. The seats are available again."
            : confirm.error instanceof Error
              ? confirm.error.message
              : "Could not confirm"}
        </p>
      )}

      <div className="flex gap-3 text-xs">
        <Link to="/" className="text-neutral-400 underline">
          ← Showtimes
        </Link>
        <Link to={`/shows/${data.showId}/seats`} className="text-neutral-400 underline">
          Seat map
        </Link>
      </div>
    </div>
  );
}
