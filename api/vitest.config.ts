import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL, TEST_MONGO_URL } from "./tests/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],

    /// These tests share one database and reset the same show between cases.
    /// Running files in parallel would have them resetting each other's rows
    /// mid-test, which looks exactly like a concurrency bug and is not one.
    fileParallelism: false,

    /// A contended claim legitimately queues behind row locks, and the reserve
    /// path allows up to 10s of that before giving up.
    testTimeout: 30_000,
    /// The first run creates and seeds a database.
    hookTimeout: 180_000,

    /// Set before any test file imports src/db/postgres.ts, which reads
    /// DATABASE_URL at module load to build its singleton.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      MONGO_URL: TEST_MONGO_URL,
      NODE_ENV: "test",
    },
  },
});
