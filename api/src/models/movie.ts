import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

// Catalog content only. Nothing here is transactional, nothing here is
// contended, and nothing here is ever written by a user request.
//
// `strict: false` is deliberately NOT set: variable-shape is the reason this
// lives in Mongo, but the fields the UI depends on should still be declared.

const castMemberSchema = new Schema(
  {
    name: { type: String, required: true },
    role: { type: String, required: true },
  },
  { _id: false }
);

const movieSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    synopsis: { type: String, required: true },
    runtimeMinutes: { type: Number, required: true },
    /// BBFC-style age rating, e.g. "12A", "15", "18".
    certification: { type: String, required: true },
    genres: { type: [String], default: [] },
    releaseDate: { type: Date, required: true },
    director: { type: String },
    cast: { type: [castMemberSchema], default: [] },
    /// Formats the film is distributed in. Which of these a given cinema
    /// actually shows is a Postgres concern (Show.format), not a catalog one.
    formats: { type: [String], default: ["2D"] },
    posterUrl: { type: String, default: null },
    trailerUrl: { type: String, default: null },
  },
  { timestamps: true, collection: "movies" }
);

// Browse page sorts by release date; slug is the human-facing lookup key.
movieSchema.index({ releaseDate: -1 });

export type Movie = InferSchemaType<typeof movieSchema>;
export type MovieDoc = HydratedDocument<Movie>;

export const MovieModel = model<Movie>("Movie", movieSchema);
