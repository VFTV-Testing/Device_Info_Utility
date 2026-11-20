import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, createEnvStore, createStore } from "../../server/app";
import { readConfig } from "../../server/config";

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "dim-env-"));
  const deviceFile = path.join(dir, "deviceInformation.json");
  writeFileSync(deviceFile, "{}\n");
  const config = readConfig({ STORAGE_MODE: "local", LOCAL_DATA_FILE: deviceFile });
  const envStore = createEnvStore(config);
  const app = createApp({ store: createStore(config), envStore });
  return { http: request(app), envFile: path.join(dir, "environmentStatus.json"), envStore };
}

describe("/api/environment", () => {
  it("keeps the environment file next to the local device file", () => {
    const { envStore, envFile } = setup();
    expect(envStore?.location).toContain(path.basename(envFile));
  });

  it("starts empty, appends updates and returns the history", async () => {
    const { http, envFile } = setup();
    const empty = await http.get("/api/environment").expect(200);
    expect(empty.body).toMatchObject({ doc: { version: 1, ports: {} }, version: null, readOnly: false });

    await http
      .post("/api/environment/entries")
      .send({ robot: "X111-GRE", port: "PORT1", status: "down", category: "network", note: "No internet on the box" })
      .expect(201);
    await http
      .post("/api/environment/entries")
      .send({ robot: "X111-GRE", port: "PORT1", status: "ok", category: "network", note: "Router rebooted" })
      .expect(201);

    const { body } = await http.get("/api/environment").expect(200);
    expect(body.doc.ports["X111-GRE"].PORT1.map((e: { status: string }) => e.status)).toEqual(["down", "ok"]);
    expect(JSON.parse(readFileSync(envFile, "utf8")).ports["X111-GRE"].PORT1).toHaveLength(2);
  });

  it("saves several pushed updates at once", async () => {
    const { http } = setup();
    await http
      .post("/api/environment/entries")
      .send({
        entries: [
          { robot: "X117-AL", port: "PORT1", status: "issue", category: "ir", note: "no IR backup yet" },
          { robot: "X117-AL", port: "PORT3", status: "issue", category: "ir", note: "no IR backup yet" },
        ],
      })
      .expect(201);
    const { body } = await http.get("/api/environment").expect(200);
    expect(Object.keys(body.doc.ports["X117-AL"])).toEqual(["PORT1", "PORT3"]);
  });

  it("rejects an issue without a description", async () => {
    const { http } = setup();
    const res = await http
      .post("/api/environment/entries")
      .send({ robot: "X111-GRE", port: "PORT1", status: "issue", category: "box", note: "" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("answers 404 when environment tracking is not configured", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dim-env-"));
    const deviceFile = path.join(dir, "deviceInformation.json");
    writeFileSync(deviceFile, "{}\n");
    const app = createApp({ store: createStore(readConfig({ STORAGE_MODE: "local", LOCAL_DATA_FILE: deviceFile })) });
    await request(app).get("/api/environment").expect(404);
    // Device endpoints are unaffected.
    await request(app).get("/api/devices").expect(200);
  });
});
