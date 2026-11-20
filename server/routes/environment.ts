import { Router, type Response } from "express";
import type { EnvironmentService } from "../../shared/environment";
import { AppError } from "../../shared/errors";

function actorOf(res: Response): string | undefined {
  return typeof res.locals.user === "string" ? res.locals.user : undefined;
}

/** Environment tab: issues per robot port, kept in their own file with full history. */
export function environmentRouter(service: EnvironmentService | null): Router {
  const router = Router();

  const require = (): EnvironmentService => {
    if (!service) throw new AppError(404, "NOT_FOUND", "Environment tracking is not configured on this server.");
    return service;
  };

  router.get("/environment", async (_req, res) => {
    const s = require();
    res.json({ ...(await s.getSnapshot()), readOnly: s.readOnly, location: s.location });
  });

  // Appends history entries in one save — body { entries: [...] } (or a single entry). Earlier entries never change.
  router.post("/environment/entries", async (req, res) => {
    const body = req.body as { entries?: unknown } | undefined;
    const entries = body && typeof body === "object" && "entries" in body ? body.entries : [body];
    res.status(201).json(await require().addEntries(entries, actorOf(res)));
  });

  return router;
}
