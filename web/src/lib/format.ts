export function runtimeLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/// The one place minor units become a decimal. Everything upstream — schema,
/// query, wire type — keeps them as integers, so this is the only conversion
/// and it exists purely to be read by a human.
const priceFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function priceLabel(cents: number) {
  return priceFormatter.format(cents / 100);
}

/// Showtimes cross the wire as UTC instants and are rendered in the viewer's
/// own timezone. 24-hour because cinema listings are, and because it removes
/// any am/pm ambiguity around the late screenings.
export function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/// `YYYY-MM-DD` for a Date, in local time. Deliberately not `toISOString()`,
/// which would shift the day for anyone east or west of UTC.
export function localDateKey(at: Date) {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateFromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/// "Today" and "Tomorrow" carry more meaning than a weekday does, so they win
/// for the two days most people are actually picking between. Everything else
/// gets its weekday, with the calendar date on the line below.
export function dayLabel(key: string) {
  const today = new Date();
  if (key === localDateKey(today)) return "Today";

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (key === localDateKey(tomorrow)) return "Tomorrow";

  return dateFromKey(key).toLocaleDateString(undefined, { weekday: "short" });
}

/// The second line of a date tile. Always the day and month, so that "Today"
/// and "Tomorrow" still say which date they actually are.
export function dateLabel(key: string) {
  return dateFromKey(key).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// No poster images are seeded, so cards fall back to a deterministic gradient
// derived from the slug. Keeps the seed offline — no external image host.
export function posterGradient(slug: string) {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `linear-gradient(145deg, hsl(${hash} 45% 22%), hsl(${(hash + 50) % 360} 40% 12%))`;
}
