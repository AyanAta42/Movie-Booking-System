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

    // Upsert rather than create: the same device hits this on every request.
    // `update: {}` makes a repeat visit a no-op instead of a pointless write.
    await prisma.user.upsert({
      where: { id },
      create: { id, email: `${id}@device.local`, name: `Device ${id.slice(0, 8)}` },
      update: {},
    });

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
