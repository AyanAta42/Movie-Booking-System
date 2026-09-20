import { Schema, model, type InferSchemaType } from "mongoose";

// Browsing's copy of the schedule: cinemas and showtimes, shaped for listing.
//
// Postgres owns this data — it is where shows are scheduled and where their
// seats live. These collections are a read-only projection of it, rebuilt by
// src/seed/projection.ts, so the browsing service can answer every request from
// Mongo alone (DECISIONS entry 4). Nothing but the projection writes here.
//
// Each document's _id IS the Postgres row id, as a string. That shared id is
// the whole contract between the two services: a showtime browsed from here is
// opened on the booking service by the same id.

const cinemaSchema = new Schema(
  {
    _id: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    city: { type: String, required: true },
    screenCount: { type: Number, required: true },
  },
  { collection: "cinemas", versionKey: false }
);

const showtimeSchema = new Schema(
  {
    _id: { type: String, required: true },
    cinemaId: { type: String, required: true },
    /// The catalog movie's _id, so a listing can be grouped by film.
    movieId: { type: String, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    /// Denormalised to the name — a listing shows "Screen 2", and seat geometry
    /// belongs to the booking service, not here.
    screen: { type: String, required: true },
    format: { type: String, required: true },
    /// The listed price. Booking charges from its own row, so if this copy is
    /// briefly stale the customer is shown an old price but never charged one.
    priceCents: { type: Number, required: true },
  },
  { collection: "showtimes", versionKey: false }
);

// "Shows at this cinema, in time order" — the one query browsing makes.
showtimeSchema.index({ cinemaId: 1, startsAt: 1 });

export type CinemaDoc = InferSchemaType<typeof cinemaSchema>;
export type ShowtimeDoc = InferSchemaType<typeof showtimeSchema>;

export const CinemaModel = model("Cinema", cinemaSchema);
export const ShowtimeModel = model("Showtime", showtimeSchema);
