-- CreateEnum
CREATE TYPE "SeatKind" AS ENUM ('STANDARD', 'PREMIUM', 'ACCESSIBLE');

-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('AVAILABLE', 'HELD', 'BOOKED');

-- CreateTable
CREATE TABLE "cinemas" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cinemas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screens" (
    "id" UUID NOT NULL,
    "cinema_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "screens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seats" (
    "id" UUID NOT NULL,
    "screen_id" UUID NOT NULL,
    "row_label" VARCHAR(2) NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "SeatKind" NOT NULL DEFAULT 'STANDARD',

    CONSTRAINT "seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shows" (
    "id" UUID NOT NULL,
    "screen_id" UUID NOT NULL,
    "movie_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "format" TEXT NOT NULL DEFAULT '2D',

    CONSTRAINT "shows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "show_seats" (
    "id" UUID NOT NULL,
    "show_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "status" "SeatStatus" NOT NULL DEFAULT 'AVAILABLE',
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "show_seats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cinemas_slug_key" ON "cinemas"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "screens_cinema_id_name_key" ON "screens"("cinema_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "seats_screen_id_row_label_number_key" ON "seats"("screen_id", "row_label", "number");

-- CreateIndex
CREATE INDEX "shows_movie_id_starts_at_idx" ON "shows"("movie_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "shows_screen_id_starts_at_key" ON "shows"("screen_id", "starts_at");

-- CreateIndex
CREATE INDEX "show_seats_show_id_status_idx" ON "show_seats"("show_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "show_seats_show_id_seat_id_key" ON "show_seats"("show_id", "seat_id");

-- AddForeignKey
ALTER TABLE "screens" ADD CONSTRAINT "screens_cinema_id_fkey" FOREIGN KEY ("cinema_id") REFERENCES "cinemas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_screen_id_fkey" FOREIGN KEY ("screen_id") REFERENCES "screens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shows" ADD CONSTRAINT "shows_screen_id_fkey" FOREIGN KEY ("screen_id") REFERENCES "screens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_seats" ADD CONSTRAINT "show_seats_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_seats" ADD CONSTRAINT "show_seats_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "seats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
