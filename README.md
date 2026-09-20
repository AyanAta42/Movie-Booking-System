# Movie Booking Platform

A cinema seat booking platform. The hard requirement it exists to serve:

> Two people click seat F12 for the same showing at the same millisecond.
> Exactly one of them gets it. Never both. Never neither.

## Architecture at a glance

Two services, two consistency models, and each owns exactly one store:

- **Browsing** — availability-first, eventually consistent. The film catalog,
  cinemas and showtimes, served from **MongoDB only**. Cacheable, safe to serve
  stale.
- **Booking** — consistency-first, strictly serialised. Seat maps, reservations
  and confirmation, served from **Postgres only**. Fails closed.

Postgres is the source of truth for the schedule: shows are created there,
because every seat hangs off one. Browsing reads a **copy** of the cinemas and
showtimes, projected into Mongo under the same ids (DECISIONS entry 4). The copy
may lag; it can never cause a wrong booking, because booking only ever trusts
its own rows.

The `@@unique([showId, seatId])` constraint on `show_seats` makes a
double-booking physically impossible at the storage layer. Redis (later) is a
fast rejector in front of it, never the guarantee.

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
npm run seed                # Mongo films -> Postgres schedule -> Mongo copy of it
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
  screens, seats, shows and show_seats every run. Mongo films are upserted by
  slug, so movie `_id`s survive and Postgres `shows.movie_id` references stay
  valid. The last step, `seed:projection`, copies cinemas and showtimes from
  Postgres into Mongo for the browsing service; rerun it alone
  (`npm run seed:projection`) if the two ever drift.
- `GET /health` reports the status of each database the process uses.
- `npm test` runs the suite against separate `mbp_test` / `mbp_catalog_test`
  databases, so it never touches your dev data.


## Running as microservices

The API also runs as two separate services behind a gateway, each with two
replicas — the shape it deploys in.

```
browser ─► gateway :8080 (nginx)
             ├─ /                              ─► web         (the React site)
             ├─ /api/movies, /api/cinemas      ─► browsing ×2 ─► mongo
             └─ /api/shows, /api/reservations  ─► booking  ×2 ─► postgres
```

One codebase, one image: `SERVICE=browsing` or `SERVICE=booking` decides which
routes a container serves. Unset, it serves everything, which is what
`npm run dev` and the tests use. Each service is handed only its own store's
connection string, and `tests/architecture/boundaries.test.ts` fails if either
one's code can reach the other's database.

```bash
# Databases must already be migrated and seeded (see "Running locally").
docker compose --profile stack up -d --build   # first build takes a few minutes
```

Open http://localhost:8080. Every response carries `X-Served-By`, naming the
replica that answered — watch it alternate:

```powershell
1..6 | % { (Invoke-WebRequest http://localhost:8080/api/movies -UseBasicParsing).Headers['X-Served-By'] }
```

Stop it with `docker compose --profile stack down` (data is kept; `-v` would
delete it). Plain `docker compose up -d` still starts only the databases.

| Local | AWS equivalent |
|---|---|
| `gateway` (nginx path routing) | Application Load Balancer listener rules |
| `deploy.replicas: 2` | ECS service desired count / Kubernetes `replicas` |
| `migrate` one-shot container | One-off ECS task run before a deploy |
| `postgres`, `mongo` containers | RDS for PostgreSQL, DocumentDB or MongoDB Atlas |

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

The browser calls every route under `/api` (`/api/movies`); each service also
answers without the prefix, which is what the Vite dev proxy sends.

**Browsing — Mongo only.** Read path: cacheable, safe to serve slightly stale.

| Route                          | Serves                                              |
| ------------------------------ | --------------------------------------------------- |
| `GET /movies`                  | Catalog grid, newest release first.                 |
| `GET /cinemas`                 | Cinema filter, with screen counts.                  |
| `GET /cinemas/:slug/showtimes` | One cinema's schedule for one day, grouped by film. |

`showtimes` takes an optional `?date=YYYY-MM-DD`; omit it and the API returns
the first day it has showings for, along with the full list of available dates
so the client can render a date picker without a second round trip. Cinemas and
showtimes come from browsing's projection of the Postgres schedule, and films
from the catalog — both in Mongo, so a listing never touches the database that
arbitrates seat claims.

**Booking — Postgres only.** Write path: every call identifies the device with
an `X-Device-Id` header.

| Route                            | Serves                                         |
| -------------------------------- | ---------------------------------------------- |
| `GET /shows/:id/seats`           | Seat map with live availability. Never cached. |
| `POST /reservations`             | Hold seats for ten minutes. All or nothing.    |
| `GET /reservations/:id`          | A hold, with its countdown.                    |
| `POST /reservations/:id/confirm` | Turn a hold into a booking.                    |

Every service also answers `GET /health`, reporting only the store it uses.

## Current stage

- **Booking path complete:** reserve and confirm with Postgres-only concurrency
  control, proven by a concurrency suite — simultaneous claims on one seat,
  overlapping multi-seat claims, idempotent retries, deadlock probes, expiry and
  confirmation races — plus an invariant checker run after each.
- **Split into two microservices**, each owning one store, running as two
  replicas apiece behind an nginx gateway (`docker compose --profile stack`).
- **Next:** deploy to AWS ECS (see [docs/deploy-aws.md](docs/deploy-aws.md)),
  load-test through the load balancer to find the throughput ceiling, then the
  Redis rejector (DECISIONS entry 3).
