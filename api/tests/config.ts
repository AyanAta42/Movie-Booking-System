/// Test configuration.
///
/// Tests run against their own database, never the dev one. `npm run seed` is
/// destructive, and so is the reset helper — pointing these at `mbp` would wipe
/// whatever you were looking at in Prisma Studio mid-run.
const PG_HOST = process.env.TEST_PG_HOST ?? "postgresql://mbp:mbp@localhost:5432";

export const TEST_DB = "mbp_test";

/// Same connection_limit as .env.example. The load profile is the point of these
/// tests, so the pool must not be accidentally smaller than production's.
export const TEST_DATABASE_URL = `${PG_HOST}/${TEST_DB}?schema=public&connection_limit=40`;

/// The maintenance database, used once to issue CREATE DATABASE. You cannot
/// create a database from inside the database you are creating.
export const ADMIN_DATABASE_URL = `${PG_HOST}/postgres?schema=public&connection_limit=5`;

/// Separate catalog too. The Mongo seed upserts by slug so it would be harmless
/// to share, but keeping them apart means a test run can never be the reason
/// the browse page changed.
export const TEST_MONGO_URL = process.env.TEST_MONGO_URL ?? "mongodb://localhost:27017/mbp_catalog_test";
