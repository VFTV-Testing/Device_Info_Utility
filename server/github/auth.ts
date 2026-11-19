import { createSign } from "node:crypto";
import type { GitHubAuthConfig } from "../config";
import { AppError } from "../../shared/errors";
import type { TokenProvider } from "../../shared/storeTypes";

type FetchFn = typeof fetch;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Creates the short-lived JWT a GitHub App uses to request installation tokens (RS256). */
export function createAppJwt(appId: string, privateKey: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60; // allow for clock drift
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

/**
 * GitHub App installation tokens expire after one hour; they are cached in
 * memory and refreshed five minutes before expiry. Nothing is persisted.
 */
export class AppInstallationTokenProvider implements TokenProvider {
  private cached?: { token: string; expiresAt: number };

  constructor(
    private readonly auth: Extract<GitHubAuthConfig, { kind: "app" }>,
    private readonly apiUrl: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - Date.now() > 5 * 60_000) return this.cached.token;

    let jwt: string;
    try {
      jwt = createAppJwt(this.auth.appId, this.auth.privateKey);
    } catch {
      throw new AppError(500, "CONFIG_ERROR", "The GitHub App private key is invalid. Check the server configuration.");
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.apiUrl}/app/installations/${this.auth.installationId}/access_tokens`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "device-information-manager",
        },
      });
    } catch {
      throw new AppError(503, "GITHUB_UNAVAILABLE", "GitHub could not be reached. Check the network connection.");
    }
    if (!response.ok) {
      throw new AppError(
        502,
        "GITHUB_AUTH_FAILED",
        "GitHub App authentication failed. Check the App ID, installation ID and private key.",
      );
    }
    const body = (await response.json()) as { token: string; expires_at: string };
    this.cached = { token: body.token, expiresAt: Date.parse(body.expires_at) };
    return body.token;
  }
}

export class StaticTokenProvider implements TokenProvider {
  constructor(private readonly token: string) {}
  async getToken(): Promise<string> {
    return this.token;
  }
}

export function createTokenProvider(auth: GitHubAuthConfig, apiUrl: string, fetchFn: FetchFn = fetch): TokenProvider {
  if (auth.kind === "app") return new AppInstallationTokenProvider(auth, apiUrl, fetchFn);
  return new StaticTokenProvider(auth.kind === "token" ? auth.token : "");
}
