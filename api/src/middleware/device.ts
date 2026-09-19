import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/postgres";
import { BadRequestError } from "../errors";

/// Identity without auth.
///
/// Every device generates a UUID once, keeps it in localStorage, and sends it as
/// `X-Device-Id`. That UUID *is* the user id, so a device maps to exactly one
/// User row and two devices are two different people.
///
/// This is not authentication and makes no attempt to be: anyone can send
/// anyone else's id. It exists so that "whose hold is this?" has an answer
/// during development, which a single shared test user could not give — every
/// device would have been the same person, and no amount of testing would ever
/// show one device interfering with another.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export async function attachDevice(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header("x-device-id");
    if (!header) throw new BadRequestError("X-Device-Id header is required");
    if (!UUID.test(header)) throw new BadRequestError("X-Device-Id must be a UUID");

    const id = header.toLowerCase();

    // Create-if-missing in one statement. The same device hits this on every
    // request, and a new device's first requests can arrive together — a
    // double-tap on Reserve. Prisma's `upsert` runs here as a SELECT followed by
    // an INSERT, so concurrent first requests all see "no user", all insert, and
    // all but one fail on users_pkey as a 500. ON CONFLICT does the check and
    // the write atomically, so a repeat visit is a no-op rather than a race.
    await prisma.$executeRaw`
      INSERT INTO users (id, email, name)
      VALUES (${id}::uuid, ${`${id}@device.local`}, ${`Device ${id.slice(0, 8)}`})
      ON CONFLICT (id) DO NOTHING
    `;

    req.userId = id;
    next();
  } catch (err) {
    next(err);
  }
}

/// Narrows `req.userId` for handlers mounted behind attachDevice. Throwing here
/// rather than using `!` means a route mounted without the middleware fails
/// loudly instead of writing holds owned by "undefined".
export function requireUserId(req: Request): string {
  if (!req.userId) throw new Error("attachDevice middleware did not run");
  return req.userId;
}
