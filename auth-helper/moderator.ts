/**
 * Moderator access for people without a GitHub account (e.g. stakeholders fixing issues onsite).
 *
 * One shared moderator key (a Worker secret, never in the site or the repo) lets its holder
 * add Environment STATUS updates — nothing else:
 *   POST /moderator/verify       Authorization: Bearer <key>             → { ok: true }
 *   POST /environment/entries    Authorization: Bearer <key>, { name, entries } → commit result
 *
 * The helper commits with the GitHub App's own installation token (private key = Worker secret),
 * only to the environment file, append-only, with the same validation as the app. Setup info
 * cannot be changed this way. Each entry and commit records the name the moderator gave.
 */
import { EnvironmentService } from "../shared/environment";
import { AppError } from "../shared/errors";
import { GitHubFileStore } from "../shared/githubStore";

export interface ModeratorEnv {
  /** Shared moderator key (Secret). Moderator access is off when empty. */
  MODERATOR_KEY?: string;
  /** GitHub App used to commit moderator updates. */
  GITHUB_APP_ID?: string;
  /** The App's private key (.pem as downloaded from GitHub, Secret). */
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  /** Where the environment file lives (defaults match the live site). */
  ENV_OWNER?: string;
  ENV_REPO?: string;
  ENV_BRANCH?: string;
  ENV_FILE_PATH?: string;
}

const API_URL = "https://api.github.com";
const MAX_BODY = 200_000;
const MAX_NAME = 60;

type Json = (body: unknown, status: number) => Response;

// ── constant-time key check + a simple brute-force brake ───────────────────────────────

function sameKey(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Failed attempts per client address (per Worker instance — a brake, not a guarantee). */
const failures = new Map<string, { count: number; until: number }>();
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 10 * 60_000;

function clientId(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For") ?? "local";
}

function tooManyFailures(id: string, now: number): boolean {
  const f = failures.get(id);
  return Boolean(f && f.until > now && f.count >= FAIL_LIMIT);
}

function recordFailure(id: string, now: number): void {
  const f = failures.get(id);
  if (!f || f.until <= now) failures.set(id, { count: 1, until: now + FAIL_WINDOW_MS });
  else f.count++;
}

// ── GitHub App installation token (RS256 JWT via WebCrypto) ───────────────────────────

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64url(text: string): string {
  return b64urlFromBytes(new TextEncoder().encode(text));
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) {
    out.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | out.length, ...out];
}

/** GitHub hands out PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto needs PKCS#8 — wrap it. */
export function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  if (!/BEGIN RSA PRIVATE KEY/.test(pem)) return der; // already PKCS#8
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(der.length), ...der];
  const inner = [0x02, 0x01, 0x00, ...algorithm, ...octet];
  return Uint8Array.from([0x30, ...derLength(inner.length), ...inner]);
}

async function createAppJwt(appId: string, privateKeyPem: string, now = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(privateKeyPem).slice().buffer as ArrayBuffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000) - 60;
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: appId }))}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned).slice().buffer as ArrayBuffer));
  return `${unsigned}.${b64urlFromBytes(signature)}`;
}

let cachedToken: { token: string; expiresAt: number; installation: string } | null = null;

async function installationToken(env: ModeratorEnv, fetchFn: typeof fetch): Promise<string> {
  const installation = env.GITHUB_APP_INSTALLATION_ID!;
  if (cachedToken && cachedToken.installation === installation && cachedToken.expiresAt - Date.now() > 5 * 60_000) return cachedToken.token;
  let jwt: string;
  try {
    jwt = await createAppJwt(env.GITHUB_APP_ID!, env.GITHUB_APP_PRIVATE_KEY!);
  } catch {
    throw new AppError(500, "CONFIG_ERROR", "The helper's GitHub App private key is invalid.");
  }
  const response = await fetchFn(`${API_URL}/app/installations/${encodeURIComponent(installation)}/access_tokens`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "device-information-manager" },
  }).catch(() => {
    throw new AppError(503, "GITHUB_UNAVAILABLE", "GitHub could not be reached.");
  });
  if (!response.ok) throw new AppError(502, "GITHUB_AUTH_FAILED", `GitHub refused the helper's App credentials (${response.status}). Check the App ID, installation ID and private key.`);
  const body = (await response.json()) as { token?: string; expires_at?: string };
  if (!body.token) throw new AppError(502, "GITHUB_AUTH_FAILED", "GitHub did not issue an installation token.");
  cachedToken = { token: body.token, expiresAt: body.expires_at ? Date.parse(body.expires_at) : Date.now() + 50 * 60_000, installation };
  return body.token;
}

// ── request handling ─────────────────────────────────────────────────────────────────

export function isModeratorPath(pathname: string): boolean {
  return pathname.endsWith("/moderator/verify") || pathname.endsWith("/environment/entries");
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name.length >= 2 && name.length <= MAX_NAME ? name : null;
}

export async function handleModeratorRequest(request: Request, env: ModeratorEnv, json: Json, fetchFn: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST") return json({ error: "not_found" }, 404);
  if (!env.MODERATOR_KEY) return json({ error: "moderator_off", error_description: "Moderator access is not turned on." }, 503);

  const id = clientId(request);
  const now = Date.now();
  if (tooManyFailures(id, now)) return json({ error: "too_many_attempts", error_description: "Too many wrong keys. Try again in a few minutes." }, 429);
  const given = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !sameKey(given, env.MODERATOR_KEY)) {
    recordFailure(id, now);
    return json({ error: "invalid_key", error_description: "That moderator key is not valid." }, 401);
  }

  if (url.pathname.endsWith("/moderator/verify")) return json({ ok: true }, 200);

  // POST /environment/entries
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_APP_INSTALLATION_ID) {
    return json({ error: "not_configured", error_description: "The helper is missing its GitHub App settings for moderator saves." }, 503);
  }
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY) return json({ error: "too_large", error_description: "Too many updates in one push." }, 413);
  let body: { name?: unknown; entries?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "bad_request", error_description: "Expected a JSON body." }, 400);
  }
  const name = cleanName(body.name);
  if (!name) return json({ error: "bad_request", error_description: `Give your name (2–${MAX_NAME} characters).` }, 400);
  if (!Array.isArray(body.entries) || body.entries.length === 0) return json({ error: "bad_request", error_description: "There are no updates to save." }, 400);
  if (body.entries.some((e) => typeof e === "object" && e !== null && "setup" in e)) {
    return json({ error: "forbidden", error_description: "Moderators can update the status only. Setup info is changed by the team." }, 403);
  }

  const store = new GitHubFileStore({
    owner: env.ENV_OWNER || "VFTV-Testing",
    repo: env.ENV_REPO || "Device_Info_Utility",
    branch: env.ENV_BRANCH || "main",
    filePath: (env.ENV_FILE_PATH || "environment/environmentStatus.json").replace(/^\/+/, ""),
    apiUrl: API_URL,
    tokens: { getToken: () => installationToken(env, fetchFn) },
    fetchFn,
    readOnly: false,
  });
  try {
    const result = await new EnvironmentService(store).addEntries(body.entries, `${name} (moderator)`);
    return json(result, 201);
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.code, error_description: error.message, details: error.details }, error.status);
    return json({ error: "internal", error_description: "The update could not be saved." }, 500);
  }
}
