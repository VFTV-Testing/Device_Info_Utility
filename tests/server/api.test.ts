import { generateKeyPairSync, createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, createStore } from "../../server/app";
import { readConfig } from "../../server/config";
import { createAppJwt } from "../../server/github/auth";
import type { DeviceData, DeviceRecord } from "../../shared/types";
import { FakeGitHub } from "./fakeGitHub";

const fileText = readFileSync("deviceInformation.json", "utf8");
const KEY = "X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC";
const OTHER = "X121-IE-PORT4-AVSB-FUT-IE_PROD-MCAST";
const original = (JSON.parse(fileText) as DeviceData)[KEY]!;
const edited: DeviceRecord = { ...original, sprintNo: "68.00+422608.047.00150", Cver: "0.68.00", appVersion: "0.68.00" };

const ENV = {
  STORAGE_MODE: "github",
  GITHUB_OWNER: "acme",
  GITHUB_REPO: "devices",
  GITHUB_BRANCH: "main",
  GITHUB_FILE_PATH: "deviceInformation.json",
  GITHUB_TOKEN: "test-token-not-real",
};

function setup(options: { text?: string | null; env?: Record<string, string> } = {}) {
  const gh = new FakeGitHub({ initialText: options.text === undefined ? fileText : options.text });
  const config = readConfig({ ...ENV, ...options.env });
  const store = createStore(config, gh.fetch);
  const app = createApp({ store, basicAuth: config.basicAuth });
  return { gh, app, http: request(app) };
}

const parse = (gh: FakeGitHub) => JSON.parse(gh.text!) as DeviceData;

describe("reading from GitHub", () => {
  it("fetches and validates the file", async () => {
    const { http, gh } = setup();
    const res = await http.get("/api/devices").expect(200);
    expect(Object.keys(res.body.data)).toHaveLength(72);
    expect(res.body.version).toBe(gh.sha);
    expect(gh.requests[0]).toMatchObject({ method: "GET", url: "/repos/acme/devices/contents/deviceInformation.json?ref=main" });
    expect(gh.requests[0]!.auth).toBe("Bearer test-token-not-real");
  });

  it("exposes non-secret configuration only", async () => {
    const { http } = setup();
    const res = await http.get("/api/config").expect(200);
    expect(res.body).toEqual({
      storage: "github",
      location: "acme/devices@main:deviceInformation.json",
      repoUrl: "https://github.com/acme/devices/blob/main/deviceInformation.json",
      authEnabled: false,
      readOnly: false,
    });
    expect(JSON.stringify(res.body)).not.toContain("test-token");
  });

  it("reports a missing file clearly", async () => {
    const { http } = setup({ text: null });
    const res = await http.get("/api/devices").expect(404);
    expect(res.body.error.code).toBe("FILE_MISSING");
  });

  it("reports invalid JSON in the repository", async () => {
    const { http } = setup({ text: "{ broken" });
    expect((await http.get("/api/devices").expect(422)).body.error.code).toBe("FILE_INVALID");
  });

  it("reports structural problems in the repository file", async () => {
    const { http } = setup({ text: JSON.stringify({ k: { ...original, Pipeline: "x" } }) });
    const res = await http.get("/api/devices").expect(422);
    expect(res.body.error.details.problems[0]).toMatch(/Pipeline/);
  });

  it.each([
    ["auth", 502, "GITHUB_AUTH_FAILED"],
    ["rate-limit", 429, "GITHUB_RATE_LIMITED"],
    ["forbidden", 502, "GITHUB_PERMISSION_DENIED"],
    ["network", 503, "GITHUB_UNAVAILABLE"],
    ["server", 503, "GITHUB_UNAVAILABLE"],
  ] as const)("maps GitHub %s failures to a safe error", async (failure, status, code) => {
    const { http, gh } = setup();
    gh.failure = failure;
    const res = await http.get("/api/devices").expect(status);
    expect(res.body.error.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toContain("test-token");
    expect(res.body.error.stack).toBeUndefined();
  });
});

describe("saving to GitHub", () => {
  it("commits an update of exactly one record with a meaningful message", async () => {
    const { http, gh } = setup();
    const res = await http.put("/api/devices/records").send({ key: KEY, base: original, values: edited }).expect(200);

    expect(gh.commits).toHaveLength(1);
    expect(gh.commits[0]!.message.split("\n")[0]).toBe("Update device information: X101-GER PORT1");
    expect(res.body.commit.sha).toBe(gh.commits[0]!.sha);
    expect(res.body.commit.url).toContain("/commit/");
    expect(res.body.version).toBe(gh.sha);

    const saved = parse(gh);
    expect(saved[KEY]).toEqual(edited);
    const before = JSON.parse(fileText) as DeviceData;
    for (const k of Object.keys(before)) if (k !== KEY) expect(saved[k]).toEqual(before[k]);
    // The PUT used the SHA it had just read
    const put = gh.requests.find((r) => r.method === "PUT")!;
    expect((put.body as { sha: string }).sha).toBe(FakeGitHub.blobSha(fileText));
  });

  it("keeps the file's formatting — the diff is limited to the changed lines", async () => {
    const { http, gh } = setup();
    await http.put("/api/devices/records").send({ key: KEY, base: original, values: edited }).expect(200);
    const beforeLines = fileText.split("\n");
    const afterLines = gh.text!.split("\n");
    expect(afterLines).toHaveLength(beforeLines.length);
    expect(afterLines.filter((line, i) => line !== beforeLines[i])).toHaveLength(3);
  });

  it("creates a record and rejects a duplicate key without overwriting", async () => {
    const { http, gh } = setup();
    const key = "X200-GER-PORT1-AVSB-FUT-DE_PROD-DVBC";
    const res = await http.post("/api/devices/records").send({ key, values: edited }).expect(201);
    expect(res.body.commit.message).toBe("Add device information: X200-GER PORT1");
    expect(parse(gh)[key]).toEqual(edited);

    const dup = await http.post("/api/devices/records").send({ key: KEY, values: edited }).expect(409);
    expect(dup.body.error.code).toBe("RECORD_CONFLICT");
    expect(parse(gh)[KEY]).toEqual(original);
    expect(gh.commits).toHaveLength(1);
  });

  it("rejects malformed new identifiers", async () => {
    const { http } = setup();
    const res = await http.post("/api/devices/records").send({ key: "no-port-here", values: edited }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("deletes only the selected key", async () => {
    const { http, gh } = setup();
    await http.delete("/api/devices/records").send({ key: KEY, base: original }).expect(200);
    const saved = parse(gh);
    expect(KEY in saved).toBe(false);
    expect(Object.keys(saved)).toHaveLength(71);
    expect(gh.commits[0]!.message).toMatch(/^Delete device information: X101-GER PORT1/);
  });

  it("strips properties other than the six fields (e.g. Pipeline)", async () => {
    const { http, gh } = setup();
    await http
      .put("/api/devices/records")
      .send({ key: KEY, base: original, values: { ...edited, Pipeline: "nightly" }, pipeline: "nightly" })
      .expect(200);
    expect(gh.text).not.toMatch(/pipeline/i);
  });

  it("rejects invalid values and does not commit", async () => {
    const { http, gh } = setup();
    const res = await http.put("/api/devices/records").send({ key: KEY, base: original, values: { ...edited, Cver: "" } }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(gh.commits).toHaveLength(0);
  });

  it("returns an error, never success, when GitHub rejects the commit", async () => {
    const { http, gh } = setup();
    gh.beforePut = () => {
      gh.failure = "forbidden";
    };
    const res = await http.put("/api/devices/records").send({ key: KEY, base: original, values: edited });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.commit).toBeUndefined();
    expect(gh.commits).toHaveLength(0);
  });

  it("returns an authentication error on 401", async () => {
    const { http, gh } = setup();
    gh.failure = "auth";
    const res = await http.put("/api/devices/records").send({ key: KEY, base: original, values: edited }).expect(502);
    expect(res.body.error.code).toBe("GITHUB_AUTH_FAILED");
  });
});

describe("concurrency protection", () => {
  it("detects that the same record was changed by someone else and does not overwrite it", async () => {
    const { http, gh } = setup();
    const theirs = { ...(JSON.parse(fileText) as DeviceData), [KEY]: { ...original, Country: "DE_OTT" } };
    gh.externalCommit(JSON.stringify(theirs, null, 4) + "\n");

    const res = await http.put("/api/devices/records").send({ key: KEY, base: original, values: edited }).expect(409);
    expect(res.body.error.code).toBe("RECORD_CONFLICT");
    expect(res.body.error.details.conflicts[0]).toMatchObject({ key: KEY, reason: "modified", latest: { Country: "DE_OTT" } });
    expect(parse(gh)[KEY]!.Country).toBe("DE_OTT");
  });

  it("merges into the latest file so an unrelated concurrent change is not lost", async () => {
    const { http, gh } = setup();
    const theirs = JSON.parse(fileText) as DeviceData;
    theirs[OTHER] = { ...theirs[OTHER]!, Cver: "9.99.99" };
    gh.externalCommit(JSON.stringify(theirs, null, 4) + "\n");

    await http.put("/api/devices/records").send({ key: KEY, base: original, values: edited }).expect(200);
    const saved = parse(gh);
    expect(saved[KEY]).toEqual(edited);
    expect(saved[OTHER]!.Cver).toBe("9.99.99");
  });

  it("retries when another commit lands between reading and writing (stale SHA → 409)", async () => {
    const { http, gh } = setup();
    let raced = false;
    gh.beforePut = () => {
      if (raced) return;
      raced = true;
      const theirs = JSON.parse(gh.text!) as DeviceData;
      theirs[OTHER] = { ...theirs[OTHER]!, Hardware: "GEN3" };
      gh.externalCommit(JSON.stringify(theirs, null, 4) + "\n");
    };
    await http.put("/api/devices/records").send({ key: KEY, base: original, values: edited }).expect(200);
    expect(gh.requests.filter((r) => r.method === "PUT")).toHaveLength(2);
    const saved = parse(gh);
    expect(saved[KEY]).toEqual(edited);
    expect(saved[OTHER]!.Hardware).toBe("GEN3");
  });

  it("reports a conflict if the racing commit touched the same record", async () => {
    const { http, gh } = setup();
    let raced = false;
    gh.beforePut = () => {
      if (raced) return;
      raced = true;
      const theirs = JSON.parse(gh.text!) as DeviceData;
      theirs[KEY] = { ...theirs[KEY]!, Hardware: "GEN3" };
      gh.externalCommit(JSON.stringify(theirs, null, 4) + "\n");
    };
    const res = await http.put("/api/devices/records").send({ key: KEY, base: original, values: edited }).expect(409);
    expect(res.body.error.code).toBe("RECORD_CONFLICT");
    expect(parse(gh)[KEY]!.Hardware).toBe("GEN3");
  });

  it("serialises simultaneous saves from two users without losing either", async () => {
    const { http, gh } = setup();
    const otherOriginal = (JSON.parse(fileText) as DeviceData)[OTHER]!;
    const [a, b] = await Promise.all([
      http.put("/api/devices/records").send({ key: KEY, base: original, values: edited }),
      http.put("/api/devices/records").send({ key: OTHER, base: otherOriginal, values: { ...otherOriginal, Cver: "1.2.3" } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const saved = parse(gh);
    expect(saved[KEY]).toEqual(edited);
    expect(saved[OTHER]!.Cver).toBe("1.2.3");
  });
});

describe("bulk import", () => {
  it("add-only mode refuses updates", async () => {
    const { http, gh } = setup();
    const res = await http
      .post("/api/devices/import")
      .send({ mode: "add-only", mutations: [{ type: "update", key: KEY, base: original, values: edited }] })
      .expect(400);
    expect(res.body.error.message).toMatch(/Add-only/);
    expect(gh.commits).toHaveLength(0);
  });

  it("update-existing adds and updates in a single commit", async () => {
    const { http, gh } = setup();
    await http
      .post("/api/devices/import")
      .send({
        mode: "update-existing",
        mutations: [
          { type: "create", key: "X300-ES-PORT1-GEN3-FUT-ES_PROD-HFC", values: edited },
          { type: "update", key: KEY, base: original, values: edited },
        ],
      })
      .expect(200);
    expect(gh.commits).toHaveLength(1);
    expect(gh.commits[0]!.message.split("\n")[0]).toBe("Import device information: 1 added, 1 updated");
    expect(Object.keys(parse(gh))).toHaveLength(73);
  });

  it("is all-or-nothing when one imported record conflicts", async () => {
    const { http, gh } = setup();
    await http
      .post("/api/devices/import")
      .send({
        mode: "add-only",
        mutations: [
          { type: "create", key: "X300-ES-PORT1-GEN3-FUT-ES_PROD-HFC", values: edited },
          { type: "create", key: KEY, values: edited },
        ],
      })
      .expect(409);
    expect(gh.commits).toHaveLength(0);
  });

  it("never allows deletes through import", async () => {
    const { http } = setup();
    await http.post("/api/devices/import").send({ mode: "update-existing", mutations: [{ type: "delete", key: KEY, base: original }] }).expect(400);
  });
});

describe("initialisation", () => {
  it("creates {} when the file is missing", async () => {
    const { http, gh } = setup({ text: null });
    await http.post("/api/devices/initialize").expect(201);
    expect(gh.text).toBe("{}\n");
  });

  it("refuses to initialise over an existing file", async () => {
    const { http, gh } = setup();
    const res = await http.post("/api/devices/initialize").expect(409);
    expect(res.body.error.code).toBe("FILE_EXISTS");
    expect(gh.text).toBe(fileText);
  });
});

describe("read-only mode (no credentials)", () => {
  const noCreds = { GITHUB_TOKEN: "" };

  it("reads a public repo anonymously, without an Authorization header", async () => {
    const { http, gh } = setup({ env: noCreds });
    await http.get("/api/devices").expect(200);
    expect(gh.requests[0]!.auth).toBeNull();
    expect((await http.get("/api/config").expect(200)).body.readOnly).toBe(true);
  });

  it("refuses every write before contacting GitHub", async () => {
    const { http, gh } = setup({ env: noCreds });
    const res = await http.put("/api/devices/records").send({ key: KEY, base: original, values: edited }).expect(403);
    expect(res.body.error.code).toBe("READ_ONLY");
    await http.post("/api/devices/initialize").expect(403);
    expect(gh.requests.filter((r) => r.method === "PUT")).toHaveLength(0);
    expect(gh.text).toBe(fileText);
  });
});

describe("optional basic authentication", () => {
  const env = { APP_BASIC_AUTH_USER: "qa", APP_BASIC_AUTH_PASSWORD: "s3cret" };

  it("requires credentials when configured", async () => {
    const { http } = setup({ env });
    await http.get("/api/devices").expect(401);
    await http.get("/api/devices").auth("qa", "wrong").expect(401);
    const res = await http.get("/api/config").auth("qa", "s3cret").expect(200);
    expect(res.body).toMatchObject({ authEnabled: true, user: "qa" });
  });

  it("records who requested the change in the commit message", async () => {
    const { http, gh } = setup({ env });
    await http.put("/api/devices/records").auth("qa", "s3cret").send({ key: KEY, base: original, values: edited }).expect(200);
    expect(gh.commits[0]!.message).toContain("Requested by: qa");
  });
});

describe("configuration", () => {
  it("fails fast with a clear message when GitHub settings are missing", () => {
    expect(() => readConfig({ STORAGE_MODE: "github" })).toThrow(/GITHUB_OWNER is required[\s\S]*GITHUB_REPO is required/);
  });

  it("supports a nested file path on a non-default branch (e.g. the Configs repo)", async () => {
    const gh = new FakeGitHub({ repo: "Configs", branch: "Main", path: "AVSB_GEN3_Configs/deviceInformation.json", initialText: fileText });
    const config = readConfig({ ...ENV, GITHUB_REPO: "Configs", GITHUB_BRANCH: "Main", GITHUB_FILE_PATH: "AVSB_GEN3_Configs/deviceInformation.json" });
    const http = request(createApp({ store: createStore(config, gh.fetch) }));
    await http.get("/api/devices").expect(200);
    expect(gh.requests[0]!.url).toBe("/repos/acme/Configs/contents/AVSB_GEN3_Configs/deviceInformation.json?ref=Main");
    await http.put("/api/devices/records").send({ key: KEY, base: original, values: edited }).expect(200);
    expect(parse(gh)[KEY]).toEqual(edited);
  });

  it("supports GitHub App authentication with a signed RS256 JWT", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = createAppJwt("12345", pem, Date.UTC(2026, 0, 1));
    const [header, payload, signature] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toMatchObject({ iss: "12345" });

    const config = readConfig({
      ...ENV,
      GITHUB_TOKEN: "",
      GITHUB_APP_ID: "12345",
      GITHUB_APP_INSTALLATION_ID: "678",
      GITHUB_APP_PRIVATE_KEY: pem.replace(/\n/g, "\\n"),
    });
    expect(config.github?.auth).toMatchObject({ kind: "app", appId: "12345", installationId: "678" });
  });
});
