import { prisma } from "../db/postgres";

/// The shape the cinema picker consumes. Declared explicitly rather than
/// leaking the Prisma row, so the wire contract does not silently change when
/// the schema does.
export type CinemaListItem = {
  id: string;
  slug: string;
  name: string;
  city: string;
  screenCount: number;
};

/// Read path, and about as cacheable as data gets — a cinema's name and screen
/// count change on the order of never. Lives in Postgres rather than Mongo only
/// because screens and seats are transactional; this particular projection of
/// it is pure browse content.
export async function listCinemas(): Promise<CinemaListItem[]> {
  const rows = await prisma.cinema.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      city: true,
      _count: { select: { screens: true } },
    },
    orderBy: [{ city: "asc" }, { name: "asc" }],
  });

  return rows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    city: c.city,
    screenCount: c._count.screens,
  }));
}
