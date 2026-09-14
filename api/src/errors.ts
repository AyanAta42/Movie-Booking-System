/// Error types the HTTP layer knows how to turn into status codes.
///
/// These are classes rather than tagged plain objects so that the error
/// middleware in index.ts can narrow on them with `instanceof` — that is the
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

export type HttpError = BadRequestError | NotFoundError;

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof BadRequestError || err instanceof NotFoundError;
}
