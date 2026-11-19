import { describe, expect, it, vi } from "vitest";
import { handleAuthRequest } from "../../auth-helper/handler";

const env = {
  GITHUB_CLIENT_ID: "Iv1.abc",
  GITHUB_CLIENT_SECRET: "super-secret",
  ALLOWED_ORIGINS: "https://vftv-testing.github.io, http://localhost:5173",
};
const ORIGIN = "https://vftv-testing.github.io";

function post(path: string, body: unknown, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  return new Request(`https://helper.example${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function github(response: Record<string, unknown>) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(response), { status: 200 }));
}

describe("sign-in helper", () => {
  it("exchanges a code for a user token using the secret server-side only", async () => {
    const fetchFn = github({ access_token: "ghu_x", expires_in: 28800, refresh_token: "ghr_y", refresh_token_expires_in: 15897600 });
    const res = await handleAuthRequest(post("/token", { code: "abc123" }), env, fetchFn as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const body = await res.json();
    expect(body).toEqual({ access_token: "ghu_x", expires_in: 28800, refresh_token: "ghr_y", refresh_token_expires_in: 15897600 });
    expect(JSON.stringify(body)).not.toContain("super-secret");

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://github.com/login/oauth/access_token");
    const sent = new URLSearchParams(String(init!.body));
    expect(Object.fromEntries(sent)).toEqual({ client_id: "Iv1.abc", client_secret: "super-secret", code: "abc123" });
  });

  it("refreshes a token", async () => {
    const fetchFn = github({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new" });
    const res = await handleAuthRequest(post("/refresh", { refresh_token: "ghr_old" }), env, fetchFn as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const sent = new URLSearchParams(String(fetchFn.mock.calls[0]![1]!.body));
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe("ghr_old");
  });

  it("rejects pages that are not on the allow-list", async () => {
    const fetchFn = github({ access_token: "ghu_x" });
    const res = await handleAuthRequest(post("/token", { code: "abc" }, "https://evil.example"), env, fetchFn as unknown as typeof fetch);
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("answers CORS preflight only for allowed origins", async () => {
    const preflight = (origin: string) =>
      handleAuthRequest(new Request("https://helper.example/token", { method: "OPTIONS", headers: { Origin: origin } }), env);
    const ok = await preflight("http://localhost:5173");
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect((await preflight("https://evil.example")).status).toBe(403);
  });

  it("validates input and passes GitHub errors through without the secret", async () => {
    expect((await handleAuthRequest(post("/token", {}), env)).status).toBe(400);
    expect((await handleAuthRequest(post("/token", { code: "a b<script>" }), env)).status).toBe(400);
    const fetchFn = github({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." });
    const res = await handleAuthRequest(post("/token", { code: "expired" }), env, fetchFn as unknown as typeof fetch);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." });
  });

  it("refuses (instead of crashing) when ALLOWED_ORIGINS is not set", async () => {
    const res = await handleAuthRequest(post("/token", { code: "abc" }), { ...env, ALLOWED_ORIGINS: undefined as unknown as string });
    expect(res.status).toBe(403);
  });

  it("reports missing configuration", async () => {
    const res = await handleAuthRequest(post("/token", { code: "abc" }), { ...env, GITHUB_CLIENT_SECRET: "" });
    expect(res.status).toBe(500);
  });
});
