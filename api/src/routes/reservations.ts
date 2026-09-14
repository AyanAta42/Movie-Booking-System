import { Router } from "express";
import { confirm } from "../domain/confirm";
import { reserve } from "../domain/reserve";
import { BadRequestError } from "../errors";
import { attachDevice, requireUserId } from "../middleware/device";
import { getReservation } from "../queries/reservations";

export const reservationsRouter = Router();

reservationsRouter.use(attachDevice);

/// Shape-check only. Anything about seat availability, expiry or idempotency is
/// the domain's business — if this function grows a rule, the rule is in the
/// wrong file.
function parseBody(body: unknown): { showId: string; seatIds: string[]; idempotencyKey: string } {
  const b = body as Record<string, unknown>;
  const showId = typeof b?.showId === "string" ? b.showId : null;
  const idempotencyKey = typeof b?.idempotencyKey === "string" ? b.idempotencyKey : null;
  const seatIds = Array.isArray(b?.seatIds) && b.seatIds.every((s) => typeof s === "string")
    ? (b.seatIds as string[])
    : null;

  if (!showId) throw new BadRequestError("showId must be a string");
  if (!seatIds) throw new BadRequestError("seatIds must be an array of strings");
  if (!idempotencyKey) throw new BadRequestError("idempotencyKey must be a string");

  return { showId, seatIds, idempotencyKey };
}

reservationsRouter.post("/", async (req, res, next) => {
  try {
    const { showId, seatIds, idempotencyKey } = parseBody(req.body);
    const held = await reserve({ userId: requireUserId(req), showId, seatIds, idempotencyKey });
    res.status(201).json(held);
  } catch (err) {
    next(err);
  }
});

reservationsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await getReservation(req.params.id, requireUserId(req)));
  } catch (err) {
    next(err);
  }
});

reservationsRouter.post("/:id/confirm", async (req, res, next) => {
  try {
    res.json(await confirm(req.params.id, requireUserId(req)));
  } catch (err) {
    next(err);
  }
});
