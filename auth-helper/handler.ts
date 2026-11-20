/**
 * "Sign in with GitHub" token-exchange helper.
 *
 * A static page (GitHub Pages) cannot finish GitHub's OAuth flow by itself: turning
 * the one-time `code` into a user token needs the GitHub App's CLIENT SECRET, and
 * GitHub's token endpoint does not allow browser (CORS) requests. This helper does
 * exactly that one step — nothing else. It stores nothing and logs no tokens.
 *
 * Runs unchanged on Cloudflare Workers (worker.ts), and locally under Node (local.ts).
 *
 *   POST /token    { code }           → { access_token, expires_in, refresh_token, refresh_token_expires_in }
 *   POST /refresh  { refresh_token }  → same shape
 *   GET  /health                      → { ok: true }
 * Plus moderator access for the Environment tab (see moderator.ts):
 *   POST /moderator/verify, POST /environment/entries
 */
import { handleModeratorRequest, isModeratorPath, type ModeratorEnv } from "./moderator";

export interface AuthHelperEnv extends ModeratorEnv {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  /** Comma-separated list of page origins allowed to call the helper, e.g. "https://vftv-testing.github.io,http://localhost:5173". */
  ALLOWED_ORIGINS: string;
}

const TOKEN_URL = "https://github.com/login/oauth/access_token";

function allowedOrigin(request: Request, env: AuthHelperEnv): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleAuthRequest(request: Request, env: AuthHelperEnv, fetchFn: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const origin = allowedOrigin(request, env);

  if (request.method === "OPTIONS") {
    if (!origin) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  if (request.method === "GET" && url.pathname.endsWith("/health")) return json({ ok: true }, 200, origin);

  if (isModeratorPath(url.pathname)) {
    if (!origin) return json({ error: "origin_not_allowed", error_description: "This site is not allowed to use the helper." }, 403, null);
    return handleModeratorRequest(request, env, (body, status) => json(body, status, origin), fetchFn);
  }

  const isToken = url.pathname.endsWith("/token");
  const isRefresh = url.pathname.endsWith("/refresh");
  if (request.method !== "POST" || (!isToken && !isRefresh)) return json({ error: "not_found" }, 404, origin);
  if (!origin) return json({ error: "origin_not_allowed", error_description: "This site is not allowed to use the sign-in helper." }, 403, null);
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return json({ error: "not_configured", error_description: "The sign-in helper is missing its GitHub App settings." }, 500, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request", error_description: "Expected a JSON body." }, 400, origin);
  }

  const value = isToken ? body.code : body.refresh_token;
  if (typeof value !== "string" || !/^[\w.-]{1,512}$/.test(value)) {
    return json({ error: "bad_request", error_description: isToken ? "Missing sign-in code." : "Missing refresh token." }, 400, origin);
  }

  const params = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET });
  if (isToken) params.set("code", value);
  else {
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", value);
  }

  let upstream: Response;
  try {
    upstream = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch {
    return json({ error: "github_unreachable", error_description: "GitHub could not be reached." }, 502, origin);
  }

  const result = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  if (!upstream.ok || typeof result.access_token !== "string") {
    // GitHub reports errors like bad_verification_code with HTTP 200 — pass the reason, never the secret.
    return json(
      {
        error: typeof result.error === "string" ? result.error : "exchange_failed",
        error_description: typeof result.error_description === "string" ? result.error_description : "GitHub did not issue a token.",
      },
      400,
      origin,
    );
  }

  return json(
    {
      access_token: result.access_token,
      expires_in: result.expires_in,
      refresh_token: result.refresh_token,
      refresh_token_expires_in: result.refresh_token_expires_in,
    },
    200,
    origin,
  );
}
