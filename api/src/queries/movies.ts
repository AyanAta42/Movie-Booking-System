import { isValidObjectId } from "mongoose";
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

/// Every field `MovieListItem` needs and nothing else. Shared by both queries
/// below so the two can never drift into returning different card shapes.
const LIST_PROJECTION = "slug title runtimeMinutes certification genres releaseDate posterUrl";

type LeanMovieFields = {
  _id: unknown;
  slug: string;
  title: string;
  runtimeMinutes: number;
  certification: string;
  genres?: string[] | null;
  releaseDate: Date | string;
  posterUrl?: string | null;
};

function toListItem(d: LeanMovieFields): MovieListItem {
  return {
    id: String(d._id),
    slug: d.slug,
    title: d.title,
    runtimeMinutes: d.runtimeMinutes,
    certification: d.certification,
    genres: d.genres ?? [],
    releaseDate: new Date(d.releaseDate).toISOString(),
    posterUrl: d.posterUrl ?? null,
  };
}

/// Read path: no filters yet, no pagination yet. Read-only, non-contended,
/// and safe to serve stale — this is the query that gets cached first once
/// Redis arrives.
export async function listMovies(): Promise<MovieListItem[]> {
  const docs = await MovieModel.find({}, LIST_PROJECTION).sort({ releaseDate: -1 }).lean();

  return docs.map(toListItem);
}

/// Resolves the polyglot join in the one direction it is ever needed:
/// `shows.movie_id` values out of Postgres -> catalog documents out of Mongo.
///
/// Returns a Map so a caller holding N shows can attach titles with one query
/// instead of one per show. Ids arrive as opaque strings that no foreign key
/// constrains, so a malformed or orphaned id is a genuine possibility — those
/// are dropped here rather than thrown at Mongo, where a bad id would raise a
/// CastError and take down the whole listing.
export async function findMoviesByIds(ids: string[]): Promise<Map<string, MovieListItem>> {
  const unique = [...new Set(ids)].filter((id) => isValidObjectId(id));
  if (unique.length === 0) return new Map();

  const docs = await MovieModel.find({ _id: { $in: unique } }, LIST_PROJECTION).lean();

  return new Map(docs.map((d) => [String(d._id), toListItem(d)]));
}
