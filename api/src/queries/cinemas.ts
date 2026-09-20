import { CinemaModel } from "../models/catalog";

/// The shape the cinema picker consumes. Declared explicitly rather than
/// leaking the stored document, so the wire contract does not silently change
/// when the schema does.
export type CinemaListItem = {
  id: string;
  slug: string;
  name: string;
  city: string;
  screenCount: number;
};

/// Read path, and about as cacheable as data gets — a cinema's name and screen
/// count change on the order of never. Served from browsing's Mongo projection;
/// the cinemas themselves are owned by Postgres, where their screens and seats
/// are transactional.
export async function listCinemas(): Promise<CinemaListItem[]> {
  const docs = await CinemaModel.find({}).sort({ city: 1, name: 1 }).lean();

  return docs.map((c) => ({
    id: c._id,
    slug: c.slug,
    name: c.name,
    city: c.city,
    screenCount: c.screenCount,
  }));
}
