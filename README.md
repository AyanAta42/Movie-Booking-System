# Movie Booking Platform

A cinema seat booking platform. The hard requirement it exists to serve:

> Two people click seat F12 for the same showing at the same millisecond.
> Exactly one of them gets it. Never both. Never neither.

## Architecture at a glance

Two consistency models on two physically separate paths:

- **Read path (browsing)** — availability-first, eventually consistent. Movie
  catalog and cinema content, served from MongoDB. Cacheable, safe to serve stale.
- **Write path (seat claims)** — consistency-first, strictly serialised. Seat
  reservation and confirmation, served from Postgres. Fails closed.

Postgres is the source of truth. The `@@unique([showId, seatId])` constraint on
`show_seats` makes a double-booking physically impossible at the storage layer.
Redis (later) is a fast rejector in front of it, never the guarantee.

## Running locally

**Prerequisites:** Docker Desktop (running), Node 20+.

```bash
git clone <repo-url>
cd "Movie Booking System"

# 1. Databases. Postgres on :5432, Mongo on :27017.
docker compose up -d

# 2. API
cd api
npm ci                      # installs exactly what package-lock.json pins
cp .env.example .env        # REQUIRED — .env is gitignored and not in the repo
npx prisma migrate deploy   # applies the committed migrations
npx prisma generate         # generates the typed Prisma client
npm run seed                # Mongo first, then Postgres — order matters
npm run dev                 # http://localhost:4000

# 3. Web (new terminal)
cd web
npm ci
npm run dev                 # http://localhost:5173
```

Open http://localhost:5173. You should see eight films.

Notes for contributors:

- **`cp .env.example .env` is not optional.** `.env` is gitignored, so a fresh
  clone has no database URLs and Prisma will fail with "Environment variable not
  found: DATABASE_URL". The committed defaults point at the Docker containers and
  need no editing.
- **Use `migrate deploy`, not `migrate dev`.** `deploy` applies the migrations
  already in the repo. `migrate dev` is for *authoring* a new migration after you
  change `schema.prisma`, and running it on a clean clone invites a spurious
  second migration.
- **`npm run seed` is destructive to Postgres** — it wipes and rebuilds cinemas,
  screens, seats, shows and show_seats every run. Mongo is upserted by slug, so
  movie `_id`s survive and Postgres `shows.movie_id` references stay valid.
- `GET /health` reports the status of both databases.


## Looking at the data

Both stores have a browser-based tabular viewer. Neither is part of the running
system — they are dev tooling only.

| Store    | Viewer         | URL                     | Start it with                            |
| -------- | -------------- | ----------------------- | ---------------------------------------- |
| Postgres | Prisma Studio  | http://localhost:5555   | `cd api && npm run prisma:studio`        |
| MongoDB  | mongo-express  | http://localhost:8081   | `docker compose --profile tools up -d`   |

mongo-express sits behind the `tools` compose profile, so a plain
`docker compose up -d` still starts only Postgres and Mongo.

## Endpoints

All read path. Nothing here claims a seat, so everything is cacheable and safe
to serve slightly stale.

| Route                          | Serves                                              |
| ------------------------------ | --------------------------------------------------- |
| `GET /movies`                  | Catalog grid. Mongo only.                           |
| `GET /cinemas`                 | Cinema filter, with screen counts. Postgres only.   |
| `GET /cinemas/:slug/showtimes` | One cinema's schedule for one day. **Both stores.** |
| `GET /health`                  | Status of both databases.                           |

`showtimes` takes an optional `?date=YYYY-MM-DD`; omit it and the API returns
the first day it has showings for, along with the full list of available dates
so the client can render a date picker without a second round trip.

It is the one endpoint that performs the polyglot join: shows, screens and
prices come from Postgres, then `shows.movie_id` is resolved against the Mongo
catalog in application code, because no foreign key can span the two stores. A
`movie_id` that resolves to nothing drops that one film from the listing rather
than failing the request — an unenforceable reference has to degrade, not throw.

## Current stage

Build stage 1 complete: Postgres schema, migrations, seed data, Mongo catalog
seeded alongside, and a read-only browse page — catalog grid, cinema filter, and
per-cinema showtimes with screen, format and price.

Showtimes are deliberately **not** clickable and carry no seat availability.
Both belong to the write path: a seat count would mean inventing the
HELD-vs-BOOKED semantics that reserve/confirm has not defined yet, and with
every seat currently AVAILABLE it would read "200 left" everywhere regardless.

Next: booking service — reserve and confirm endpoints with Postgres-only
concurrency control, proven by a test firing hundreds of concurrent claims at a
single seat and asserting exactly one winner.
