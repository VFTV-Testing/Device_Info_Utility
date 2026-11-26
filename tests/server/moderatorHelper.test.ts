import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleAuthRequest, type AuthHelperEnv } from "../../auth-helper/handler";
import { serializeEnvDoc } from "../../shared/environment";
import { FakeGitHub } from "./fakeGitHub";

const ORIGIN = "https://vftv-testing.github.io";
const KEY = "amber-falcon-7Q4K-moderator-key";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" }, // what GitHub hands out
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function setup(overrides: Partial<AuthHelperEnv> = {}, devices?: FakeGitHub) {
  const gh = new FakeGitHub({
    owner: "VFTV-Testing",
    repo: "Device_Info_Utility",
    branch: "main",
    path: "environment/environmentStatus.json",
    initialText: serializeEnvDoc({ version: 1, ports: {} }),
  });
  const jwts: string[] = [];
  // Behaves like the built-in fetch in Cloudflare Workers: calling it as a method of another
  // object ("Illegal invocation") must fail, exactly as it does in production.
  const fetchFn = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    const url = new URL(String(input));
    if (url.pathname === "/app/installations/42/access_tokens") {
      jwts.push(new Headers(init?.headers).get("authorization")!.replace("Bearer ", ""));
      return new Response(JSON.stringify({ token: "inst-token", expires_at: new Date(Date.now() + 3600_000).toISOString() }), { status: 201 });
    }
    if (devices && url.pathname.startsWith(`/repos/${devices.owner}/${devices.repo}/`)) return devices.fetch(input, init);
    return gh.fetch(input, init);
  };
  const env: AuthHelperEnv = {
    GITHUB_CLIENT_ID: "Iv1.x",
    GITHUB_CLIENT_SECRET: "s",
    ALLOWED_ORIGINS: ORIGIN,
    MODERATOR_KEY: KEY,
    GITHUB_APP_ID: "1234",
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_APP_INSTALLATION_ID: "42",
    ...overrides,
  };
  const call = (path: string, { key = KEY, body, origin = ORIGIN, ip = "10.0.0.1" }: { key?: string | null; body?: unknown; origin?: string; ip?: string } = {}) =>
    handleAuthRequest(
      new Request(`https://helper.example${path}`, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "CF-Connecting-IP": ip,
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      fetchFn,
    );
  return { gh, jwts, call };
}

const update = { robot: "X111-GRE", port: "PORT4", status: "ok", note: "Router reset onsite. Internet back." };

describe("moderator access in the helper", () => {
  it("checks the shared moderator key", async () => {
    const { call } = setup();
    expect((await call("/moderator/verify")).status).toBe(200);
    expect((await call("/moderator/verify", { key: "wrong", ip: "10.0.0.2" })).status).toBe(401);
    expect((await call("/moderator/verify", { key: null, ip: "10.0.0.3" })).status).toBe(401);
  });

  it("saves status updates with the GitHub App, recording the moderator's name", async () => {
    const { gh, jwts, call } = setup();
    const res = await call("/environment/entries", { body: { name: "Priya", entries: [update] } });
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);

    // Signed with the App's private key (PKCS#1 → PKCS#8 conversion works).
    const [header, payload, signature] = jwts[0]!.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString()).iss).toBe("1234");

    // Committed with the installation token, to the environment file only.
    const put = gh.requests.find((r) => r.method === "PUT")!;
    expect(put.auth).toBe("Bearer inst-token");
    expect(put.url).toBe("/repos/VFTV-Testing/Device_Info_Utility/contents/environment/environmentStatus.json");
    expect(gh.commits.at(-1)!.message).toContain("Requested by: Priya (moderator)");
    const saved = JSON.parse(gh.text!).ports["X111-GRE"].PORT4[0];
    expect(saved).toMatchObject({ by: "Priya (moderator)", status: "ok", note: "Router reset onsite. Internet back." });
  });

  it("refuses setup changes, missing names and invalid updates", async () => {
    const { gh, call } = setup();
    expect((await call("/environment/entries", { body: { name: "Priya", entries: [{ ...update, setup: "Router 9" }] } })).status).toBe(403);
    expect((await call("/environment/entries", { body: { name: " ", entries: [update] } })).status).toBe(400);
    expect((await call("/environment/entries", { body: { name: "Priya", entries: [{ ...update, status: "down", note: "" }] } })).status).toBe(400);
    expect(gh.commits).toHaveLength(0);
  });

  it("requires the right key and an allowed site before saving", async () => {
    const { gh, call } = setup();
    expect((await call("/environment/entries", { key: "nope", body: { name: "Priya", entries: [update] }, ip: "10.0.0.9" })).status).toBe(401);
    expect((await call("/environment/entries", { origin: "https://evil.example", body: { name: "Priya", entries: [update] } })).status).toBe(403);
    expect(gh.commits).toHaveLength(0);
  });

  it("slows down repeated wrong keys from the same address", async () => {
    const { call } = setup();
    for (let i = 0; i < 10; i++) await call("/moderator/verify", { key: `bad-${i}`, ip: "10.9.9.9" });
    expect((await call("/moderator/verify", { ip: "10.9.9.9" })).status).toBe(429);
  });

  it("is off unless a moderator key is configured", async () => {
    const { call } = setup({ MODERATOR_KEY: "" });
    expect((await call("/moderator/verify")).status).toBe(503);
  });

  it("allows the Authorization header in CORS preflight", async () => {
    const res = await handleAuthRequest(
      new Request("https://helper.example/environment/entries", { method: "OPTIONS", headers: { Origin: ORIGIN } }),
      { GITHUB_CLIENT_ID: "x", GITHUB_CLIENT_SECRET: "y", ALLOWED_ORIGINS: ORIGIN },
    );
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
});

describe("moderator device changes in the helper", () => {
  const LINUX_KEY = "TES8-GER-STB1-GEN2_PREM-DE_PROD-DVBC";
  const linuxFile = () =>
    new FakeGitHub({
      owner: "VFTV-Testing",
      repo: "Configs",
      branch: "Main",
      path: "Linux_STB_Configs/deviceInformation.json",
      initialText: JSON.stringify({ [LINUX_KEY]: { sprintNo: "S118F", Hardware: "GEN2_PREM", Country: "DE_DVBC" } }, null, 4) + "\n",
    });

  it("reads the open family's file with the GitHub App", async () => {
    const devices = linuxFile();
    const { call } = setup({}, devices);
    const res = await call("/devices/read", { body: { family: "linuxstb" } });
    expect(res.status).toBe(200);
    expect(Object.keys(((await res.json()) as { data: object }).data)).toEqual([LINUX_KEY]);
    expect(devices.requests[0]!.auth).toBe("Bearer inst-token");
  });

  it("adds a device with that family's rules and records the moderator", async () => {
    const devices = linuxFile();
    const { call } = setup({}, devices);
    const key = "TES30-GER-STB2-GEN2_ENTRY-DE_PROD-OTT";
    const res = await call("/devices/write", { body: { name: "Priya", family: "linuxstb", action: "create", key, values: { sprintNo: "S120E", Hardware: "GEN2_ENTRY", Country: "DE_OTT" } } });
    expect(res.status).toBe(201);
    expect(JSON.parse(devices.text!)[key]).toEqual({ sprintNo: "S120E", Hardware: "GEN2_ENTRY", Country: "DE_OTT" });
    expect(devices.commits.at(-1)!.message).toContain("Requested by: Priya (moderator)");
  });

  it("rejects records that do not fit the family", async () => {
    const devices = linuxFile();
    const { call } = setup({}, devices);
    // Android STB fields and a PORT1 port are not Linux STB.
    const res = await call("/devices/write", {
      body: { name: "Priya", family: "linuxstb", action: "create", key: "TES30-GER-PORT1-GEN2-DE_PROD-OTT", values: { sprintNo: "S1", Hardware: "GEN2", Country: "DE_OTT" } },
    });
    expect(res.status).toBe(400);
    expect(devices.commits).toHaveLength(0);
  });

  it("refuses an unknown family, a missing name or a wrong key", async () => {
    const { call } = setup({}, linuxFile());
    expect((await call("/devices/read", { body: { family: "nope" } })).status).toBe(400);
    expect((await call("/devices/write", { body: { family: "linuxstb", action: "delete", key: "x" } })).status).toBe(400);
    expect((await call("/devices/read", { key: "wrong", ip: "10.77.0.1", body: { family: "linuxstb" } })).status).toBe(401);
  });
});
