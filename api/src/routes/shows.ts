import { Router } from "express";
import { attachDevice, requireUserId } from "../middleware/device";
import { getSeatMap } from "../queries/seats";

export const showsRouter = Router();

/// The seat map. Behind attachDevice because the response marks which seats are
/// held by the calling device, which needs to know who is asking.
showsRouter.get("/:id/seats", attachDevice, async (req, res, next) => {
  try {
    res.json(await getSeatMap(req.params.id, requireUserId(req)));
  } catch (err) {
    next(err);
  }
});
