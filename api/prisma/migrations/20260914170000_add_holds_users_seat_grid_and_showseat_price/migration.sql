-- Adds the reservation write path's storage: users, holds, the link from a
-- show_seat to the hold claiming it, per-seat captured price, and explicit seat
-- grid coordinates.
--
-- Hand-written rather than taken straight from `prisma migrate dev`, because
-- three of these columns are NOT NULL landing on tables that already hold rows
-- (1,600 seats and 44,800 show_seats). The generated version adds them NOT NULL
-- in one step and aborts. Each is therefore added nullable, backfilled from data
-- already in the database, and only then tightened to NOT NULL — so this
-- migration is safe to run against an existing database, not just a fresh one.

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holds" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "show_id" UUID NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holds_pkey" PRIMARY KEY ("id")
);

-- AlterTable: seat grid coordinates, added nullable so the backfill can run
ALTER TABLE "seats" ADD COLUMN     "grid_col" INTEGER,
ADD COLUMN     "grid_row" INTEGER;

-- Backfill grid coordinates from the existing row label and seat number.
--
-- grid_col is number - 1, a plain zero-basing.
--
-- grid_row cannot be computed arithmetically from the letter: the seed's row
-- sequence is A-H then J-K, skipping "I" by cinema convention, so ascii('J')-65
-- would give 9 where the tenth row is index 8. The mapping is therefore spelled
-- out. Any row label outside this list is left NULL and the SET NOT NULL below
-- will fail loudly rather than silently placing a seat at row 0.
UPDATE "seats" AS s
SET "grid_row" = m.idx,
    "grid_col" = s."number" - 1
FROM (VALUES
  ('A', 0), ('B', 1), ('C', 2), ('D', 3), ('E', 4),
  ('F', 5), ('G', 6), ('H', 7), ('J', 8), ('K', 9)
) AS m(label, idx)
WHERE m.label = s."row_label";

ALTER TABLE "seats" ALTER COLUMN "grid_col" SET NOT NULL,
ALTER COLUMN "grid_row" SET NOT NULL;

-- AlterTable: hold link and captured price. price_cents added nullable first,
-- for the same reason as above.
ALTER TABLE "show_seats" ADD COLUMN     "hold_id" UUID,
ADD COLUMN     "price_cents" INTEGER;

-- Backfill each show_seat's price from its show's base price. This is the same
-- value the seed will now write at materialisation time; doing it here means
-- existing rows carry the price they were always implicitly sold at, rather than
-- needing a reseed to become valid.
UPDATE "show_seats" AS ss
SET "price_cents" = sh."price_cents"
FROM "shows" AS sh
WHERE sh."id" = ss."show_id";

ALTER TABLE "show_seats" ALTER COLUMN "price_cents" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "holds_status_expires_at_idx" ON "holds"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "holds_user_id_idempotency_key_key" ON "holds"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "seats_screen_id_grid_row_grid_col_key" ON "seats"("screen_id", "grid_row", "grid_col");

-- CreateIndex
CREATE INDEX "show_seats_hold_id_idx" ON "show_seats"("hold_id");

-- AddForeignKey
ALTER TABLE "show_seats" ADD CONSTRAINT "show_seats_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holds" ADD CONSTRAINT "holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holds" ADD CONSTRAINT "holds_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
