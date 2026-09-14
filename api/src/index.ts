import "dotenv/config";
import { createApp } from "./app";
import { connectMongo } from "./db/mongo";

const port = Number(process.env.PORT ?? 4000);

async function start() {
  await connectMongo();
  // 0.0.0.0, not localhost: the point of this build is testing from a phone on
  // the same network, which cannot reach a loopback-only bind.
  createApp().listen(port, "0.0.0.0", () =>
    console.log(`[api] listening on http://0.0.0.0:${port}`)
  );
}

start().catch((err) => {
  console.error("[api] failed to start", err);
  process.exit(1);
});
