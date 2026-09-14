import { MovieModel } from "../models/movie";

/// The shape the browse page actually consumes. Declared explicitly rather than
/// leaking the Mongoose document, so the wire contract does not silently change
/// when the schema does.
export type MovieListItem = {
  id: string;
  slug: string;
  title: string;
  runtimeMinutes: number;
  certification: string;
  genres: string[];
  releaseDate: string;
  posterUrl: string | null;
};

/// Read path: no filters yet, no pagination yet. Read-only, non-contended,
/// and safe to serve stale — this is the query that gets cached first once
/// Redis arrives.
export async function listMovies(): Promise<MovieListItem[]> {
  const docs = await MovieModel.find(
    {},
    "slug title runtimeMinutes certification genres releaseDate posterUrl"
  )
    .sort({ releaseDate: -1 })
    .lean();

  return docs.map((d) => ({
    id: String(d._id),
    slug: d.slug,
    title: d.title,
    runtimeMinutes: d.runtimeMinutes,
    certification: d.certification,
    genres: d.genres ?? [],
    releaseDate: new Date(d.releaseDate).toISOString(),
    posterUrl: d.posterUrl ?? null,
  }));
}
