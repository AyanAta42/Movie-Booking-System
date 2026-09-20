# Decisions

Why this system is shaped the way it is. One entry per decision that would be
expensive to reverse, written while the reasoning was still fresh. Each records
what was chosen, what it was chosen *over*, and what would make it wrong.

---

## 1. Seats live in Postgres

**Date:** 2026-09-14 · **Status:** accepted

### Context

The whole platform exists to serve one requirement:

> Two people click seat F12 for the same showing at the same millisecond.
> Exactly one of them gets it. Never both. Never neither.

That is not a performance requirement, it is a correctness one, and it admits no
"usually". A double-booked seat means two people holding valid tickets in front
of one chair — a refund, an apology, and a customer who does not come back.

### Decision

Seat state is a row in Postgres, and Postgres is the only source of truth for it.
`show_seats` carries a `UNIQUE (show_id, seat_id)` index, and every claim is a
conditional `UPDATE` against a row that already exists.

Two details matter more than the choice of engine:

- **Rows are materialised up front**, one per seat per showing, when the show is
  created. "Available" has to be a row that can be locked and conditionally
  updated, not the *absence* of a row that two concurrent inserts would race to
  create. 44,800 rows for a week of seeded showings is nothing; the alternative
  is a race with no arbiter.
- **The unique index is the guarantee, not the application logic.** Every check
  above it — the conditional update, the Redis rejector in entry 3 — is an
  optimisation that rejects losers earlier and more cheaply. If all of that code
  is wrong at once, the database still refuses to write the second row.

### Alternatives rejected

- **Mongo for seats too, one store instead of two.** Simpler to operate, and the
  reason it fails is not that Mongo is slow — it is that expressing "claim this
  seat only if unclaimed, across a multi-seat order, atomically" needs
  transactional guarantees that a document model makes awkward at exactly the
  moment they matter most. Buying operational simplicity with the one property
  the product cannot be wrong about is the wrong trade.
- **Redis as the source of truth.** Fast and atomic, but durability is the
  problem: `SETNX` is atomic and still lost on an unlucky restart. A lost seat
  claim is a sold ticket that no longer exists.
- **Application-level locking (mutex, advisory lock, queue).** Works until there
  are two API processes, or one process restarts holding a lock. Correctness that
  depends on there being exactly one of something is not correctness.

### Consequences

- The write path fails closed. If Postgres is unreachable, no seat can be
  claimed — which is the correct behaviour, not an outage to paper over.
- Postgres becomes the capacity ceiling for booking throughput. That is a known,
  measurable limit, and entry 3 is how it gets raised.
- Seat availability cannot be served from cache without accepting staleness, so
  the seat map must read through to Postgres even though browsing does not.

### What would make this wrong

Sustained write contention that a single primary cannot absorb even with the
Redis rejector in front of it. The fix would be partitioning by show — shows are
perfectly independent, so this shards cleanly — not a different consistency model.

---

## 2. Catalog content lives in MongoDB

**Date:** 2026-09-14 · **Status:** accepted, amended by entry 4 (2026-09-20)

### Context

Film metadata — synopsis, cast, director, certification, runtime, genres,
formats, artwork — has the opposite profile to seat state in every dimension that
matters. It is read constantly and written by an editor a few times a week. It is
never contended: two people reading *Dune: Part Two* do not conflict. It is
allowed to be stale, because a synopsis that updates a minute late costs nothing.
And its shape is genuinely irregular — a re-release has no trailer, a festival
screening has no certification, a documentary has no cast list worth modelling.

### Decision

Catalog content is a document in MongoDB, served on a physically separate read
path from the write path in entry 1. The browse endpoints touch Mongo only.

They did not, at first: from the first browse page until entry 4, cinemas and
showtimes were read from Postgres, and nothing noticed the code had drifted from
this sentence. Entry 4 made it true, and `tests/architecture/boundaries.test.ts`
now fails if it stops being true.

The schema is declared in Mongoose rather than left free-form, and `strict:
false` is deliberately **not** set. Variable shape is the reason this lives in
Mongo; it is not a reason for the fields the UI depends on to be optional.
`title` and `runtimeMinutes` are required because a card cannot render without
them. `trailerUrl` is nullable because plenty of films genuinely have none.

### Alternatives rejected

- **Postgres for everything, with `jsonb` for the irregular parts.** The
  strongest alternative, and it would work. It was rejected for blast radius
  rather than capability: putting browse traffic on the same primary that
  arbitrates seat claims means a spike on the catalog — a trailer drop, a cast
  announcement — degrades the one path that must never fail. Two stores buys a
  bulkhead. One store with two schemas does not.
- **A single denormalised store serving both.** Collapses the separation that
  makes the read path cacheable and the write path strict.

### Consequences

- **No foreign key can span the two stores.** `shows.movie_id` is an opaque
  string holding a Mongo `_id`, enforced in application code. Until entry 4 this
  join ran across both stores on every showtimes request; it now runs once, when
  a show is scheduled — the title is copied into Postgres, the showtime into
  Mongo — and a listing joins showtimes to films inside Mongo alone. It is still
  made survivable rather than safe: `findMoviesByIds` drops an id
  that resolves to nothing, so a dangling reference loses one film from a listing
  instead of failing the request. An unenforceable constraint has to degrade,
  not throw.
- Every show carries its `movieId` on the wire, even where the grouped listing
  already states it once per film. The redundancy is deliberate: a show passed
  around on its own must still be able to name its film, and this is the only
  key that can do it.
- Seeding is order-dependent. Mongo first, because Postgres reads it to resolve
  slug → `movieId`. Mongo is upserted by slug so `_id`s survive a reseed and
  existing `shows.movie_id` references stay valid.
- Two stores to run, back up, and monitor. `/health` reports both.

### What would make this wrong

If the catalog stopped being irregular and settled into a fixed shape, the
variable-schema justification would evaporate and only the bulkhead argument
would remain — which a read replica also provides, at lower operational cost.

---

## 3. Redis is deferred to week 5

**Date:** 2026-09-14 · **Status:** accepted, deliberately deferred

### Context

Redis has an obvious place in this design. In front of the seat claim it is a
fast rejector: most losers in a contention spike can be turned away on an
in-memory check without ever opening a Postgres transaction. In front of the
catalog it is an ordinary cache. Both are real wins. Neither is needed yet.

### Decision

No Redis before week 5. The seat claim ships correct against Postgres alone, and
the concurrency test — hundreds of simultaneous claims on one seat, asserting
exactly one winner — must pass with no cache in the system at all.

### Reasoning

- **A cache in front of an unproven guarantee hides whether the guarantee
  works.** If Redis absorbs most of the contention, the Postgres path is barely
  exercised, and the test meant to prove "exactly one winner" quietly stops
  testing the thing that enforces it. The order matters: prove the floor, then
  build on it.
- **Redis is an optimisation here, never the guarantee.** Adding it while the
  correctness story is still being settled blurs that distinction, and the
  failure mode is a system that is correct only while the cache is up. Building
  it second makes the dependency impossible to get backwards.
- **There is no measurement to optimise against yet.** No load figures, no
  contention profile, no idea which query actually hurts. Caching before
  measuring picks the wrong thing to cache and calls it done.
- **Cache invalidation is a permanent tax.** Worth paying against a real number;
  not worth paying against a guess.

### What is being done now to make week 5 cheap

- The read path is already separated from the write path, so the cache has a
  clean seam to sit on with no refactor.
- The browse endpoints are already documented as safe to serve stale, so
  introducing a TTL is a config decision, not a semantic argument.
- `listMovies` and `listCinemas` are deliberately parameterless — trivially
  cacheable under a single key each. `listCinemas` is the most cacheable query in
  the system: a cinema's name and screen count change on the order of never.

### Consequences

- Booking throughput until week 5 is whatever one Postgres primary sustains.
  Accepted: it is measurable, and measuring it is the point.
- The concurrency test written in week 2 stays meaningful forever, because it
  proves the floor rather than the cache.

### What would make this wrong

Load arriving before week 5. If real contention shows up early, Redis moves up —
but it moves up as a rejector in front of a guarantee already proven without it,
never as a substitute for one.

---

## 4. Each service owns one store; the schedule is copied, not shared

**Date:** 2026-09-20 · **Status:** accepted

### Context

The API was split into two deployable services — browsing and booking — each
running as two replicas behind a gateway. Entry 2 had already said the browse
endpoints touch Mongo only. The code did not: cinemas and showtimes were read
from Postgres, and the seat map read film titles from Mongo. Both services
needed both stores, so splitting the deployment left one database shared by
everything — a browse spike still landed on the primary that arbitrates seat
claims, the exact coupling entry 2 exists to prevent.

The obstacle is that the schedule genuinely belongs to both. Booking cannot sell
a seat for a show it does not know, and every `show_seats` row carries a foreign
key to its show. Browsing cannot list "what's on tonight" without the same shows.

### Decision

Each service reads exactly one store, and data both need is **copied**, with a
single owner:

- **Postgres (booking) owns the schedule.** Cinemas, screens, seats and shows are
  created there, because seats hang off them.
- **Mongo (browsing) holds a read-only projection** of cinemas and showtimes,
  written only by `src/seed/projection.ts`, under the **same ids** as the
  Postgres rows. That shared id is the whole contract: a showtime listed by
  browsing is opened on booking by the same id.
- **Booking keeps its own copy of each film's title** (`shows.movie_title`), set
  when the show is scheduled, so the seat map never reads Mongo.

Enforced three ways: each container is given only its own store's connection
string; `tests/architecture/boundaries.test.ts` walks each service's imports and
fails if one reaches the other's database; `tests/browsing/projection.test.ts`
fails if the copy and the original disagree about any show.

### Alternatives rejected

- **Keep one shared database.** No duplication, and no isolation: browse traffic
  keeps competing with seat claims for the same primary. Splitting the
  deployment without splitting the data buys independently scaled stateless
  replicas and nothing else.
- **Browsing asks booking for showtimes over HTTP.** No copy to drift — but
  browsing then fails whenever booking does, and every browse request becomes
  booking load. It turns a bulkhead into a dependency.
- **Move the schedule wholly into Mongo.** Not possible without giving up the
  storage-layer guarantee: `show_seats` needs a real foreign key to a real show
  row in the same database as the seat claims (entry 1).

### Consequences

- **The copy can lag the original.** A cancelled show may stay listed until the
  projection next runs. This is safe by construction: the copy lives on the side
  that is allowed to be stale, and booking trusts only its own rows. A stale
  listing can send a customer to a show booking refuses; it can never make
  booking sell a seat it should not. The listed price may lag too, but the price
  charged is always booking's own.
- **Synchronisation is a batch job today.** `npm run seed` ends with the
  projection, and the test suite rebuilds it every run. Once shows are scheduled
  while the system is live, it becomes an event: booking publishes "show
  scheduled", browsing applies it. The mapping does not change, only its
  trigger — and that is the first place a message queue earns its keep here.
- **What is duplicated:** cinema name and city, show times, screen name, format,
  listed price, and the film title. Seats, holds and bookings exist only in
  Postgres; synopsis, cast and artwork only in Mongo.
- **The Postgres connection budget belongs to booking alone.** Browsing opens no
  Postgres connections at all, which is the point.

### What would make this wrong

A schedule that changes often enough for a lagging copy to hurt customers —
shows cancelled minutes before start, prices moving hourly. Then the projection
has to become event-driven sooner, and browsing may need to confirm with booking
at the moment of the click. The ownership would not change; only how quickly
the copy follows it.
