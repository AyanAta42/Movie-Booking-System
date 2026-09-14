/// Error types the HTTP layer knows how to turn into status codes.
///
/// These are classes rather than tagged plain objects so that the error
/// middleware in app.ts can narrow on them with `instanceof` — that is the
/// only thing they are for. Anything thrown that is *not* one of these is a
/// bug, not a client mistake, and becomes a 500.

export class BadRequestError extends Error {
  readonly status = 400;
  readonly code = "bad_request";

  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = "not_found";

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/// Somebody else got there first. The defining error of the write path, and the
/// correct outcome for every loser in a contended claim — not a failure.
export class ConflictError extends Error {
  readonly status = 409;
  readonly code = "conflict";

  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/// The hold existed and has since lapsed. Distinct from 404 on purpose: "your
/// ten minutes ran out" is a different thing for a client to show than "no such
/// reservation", even though both mean the hold is gone.
export class GoneError extends Error {
  readonly status = 410;
  readonly code = "gone";

  constructor(message: string) {
    super(message);
    this.name = "GoneError";
  }
}

/// The server is saturated, not broken. Distinct from 500 on purpose: a 500 says
/// "this request hit a bug and retrying will not help", whereas this says "there
/// was no capacity to even begin your transaction, try again". Under a burst far
/// beyond pool capacity, shedding excess load with this is correct behaviour;
/// reporting it as 500 would hide a capacity limit behind what looks like a bug.
export class ServiceUnavailableError extends Error {
  readonly status = 503;
  readonly code = "service_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

export type HttpError =
  | BadRequestError
  | NotFoundError
  | ConflictError
  | GoneError
  | ServiceUnavailableError;

export function isHttpError(err: unknown): err is HttpError {
  return (
    err instanceof BadRequestError ||
    err instanceof NotFoundError ||
    err instanceof ConflictError ||
    err instanceof GoneError ||
    err instanceof ServiceUnavailableError
  );
}

/// Prisma's two "no capacity" codes: P2024 is pool checkout timeout, P2028 is
/// transaction-start timeout. Neither means the write was attempted, so neither
/// is a lost race — both are safe for the caller to retry.
export function isSaturationCode(code: string): boolean {
  return code === "P2024" || code === "P2028";
}
