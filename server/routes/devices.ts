import { Router, type Request, type Response } from "express";
import type { AppConfigInfo } from "../../shared/types";
import { AppError } from "../../shared/errors";
import type { DeviceService } from "../../shared/deviceService";
import type { DeviceFileStore } from "../../shared/storeTypes";

function bodyOf(req: Request): Record<string, unknown> {
  const body = req.body as unknown;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError(400, "BAD_REQUEST", "Expected a JSON object in the request body.");
  }
  return body as Record<string, unknown>;
}

function actorOf(res: Response): string | undefined {
  return typeof res.locals.user === "string" ? res.locals.user : undefined;
}

export function devicesRouter(service: DeviceService, store: DeviceFileStore, authEnabled: boolean): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/config", (_req, res) => {
    const info: AppConfigInfo = {
      storage: store.kind,
      location: store.location,
      repoUrl: store.repoUrl,
      readOnly: store.readOnly,
      authEnabled,
      user: actorOf(res),
    };
    res.json(info);
  });

  router.get("/devices", async (_req, res) => {
    res.json(await service.getSnapshot());
  });

  router.post("/devices/initialize", async (_req, res) => {
    res.status(201).json(await service.initialize(actorOf(res)));
  });

  // Create a new record. Never overwrites: an existing key is reported as a conflict.
  router.post("/devices/records", async (req, res) => {
    const body = bodyOf(req);
    res.status(201).json(await service.createRecord(body.key, body.values, actorOf(res)));
  });

  // Update exactly one existing record, guarded by the values the user originally loaded.
  router.put("/devices/records", async (req, res) => {
    const body = bodyOf(req);
    res.json(await service.updateRecord(body.key, body.base, body.values, actorOf(res)));
  });

  // Delete exactly one record, guarded by the values the user saw.
  router.delete("/devices/records", async (req, res) => {
    const body = bodyOf(req);
    res.json(await service.deleteRecord(body.key, body.base, actorOf(res)));
  });

  // Bulk import: add-only produces only "create" changes; update-existing may also update.
  router.post("/devices/import", async (req, res) => {
    const body = bodyOf(req);
    res.json(await service.importRecords(body.mode, body.mutations, actorOf(res)));
  });

  router.use((_req, _res) => {
    throw new AppError(404, "NOT_FOUND", "Unknown API endpoint.");
  });

  return router;
}
