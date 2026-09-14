import mongoose from "mongoose";
import "dotenv/config";

// Singleton. Never call mongoose.connect() anywhere else.
// mongoose keeps one global connection internally, so the job of this module is
// to own the lifecycle and make "am I connected?" answerable in one place.
let connecting: Promise<typeof mongoose> | null = null;

export async function connectMongo(): Promise<typeof mongoose> {
  const url = process.env.MONGO_URL;
  if (!url) throw new Error("MONGO_URL is not set");

  if (mongoose.connection.readyState === 1) return mongoose;
  if (!connecting) {
    connecting = mongoose.connect(url, {
      // Fail fast rather than queueing forever behind a dead server. The read
      // path is allowed to serve stale data, but it is not allowed to hang.
      serverSelectionTimeoutMS: 5_000,
    });
  }
  return connecting;
}

export async function disconnectMongo(): Promise<void> {
  connecting = null;
  await mongoose.disconnect();
}

export function mongoIsConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export { mongoose };
