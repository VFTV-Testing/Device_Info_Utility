// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, completeGitHubLogin, OAuthError } from "../../src/services/githubOAuth";
import { ensureFreshSession, readStoredCredentials, type GitHubSession } from "../../src/services/githubSession";

const tokenResponse = () =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ access_token: "ghu_x", expires_in: 28800, refresh_token: "ghr_y" }), { status: 200 }),
  );

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Sign in with GitHub", () => {
  it("builds the GitHub authorize URL", () => {
    const url = new URL(buildAuthorizeUrl("s1", "https://vftv-testing.github.io/Device_Info_Utility/", "Iv1.abc"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "Iv1.abc",
      state: "s1",
      redirect_uri: "https://vftv-testing.github.io/Device_Info_Utility/",
    });
  });

  it("does nothing when the page was not opened by GitHub's redirect", async () => {
    expect(await completeGitHubLogin(tokenResponse() as unknown as typeof fetch)).toBeNull();
  });

  it("completes sign-in when the state matches, and removes the code from the address bar", async () => {
    sessionStorage.setItem("dim-oauth-state", JSON.stringify({ state: "s1", remember: true }));
    window.history.replaceState(null, "", "/app/?code=abc&state=s1#/devices");
    const fetchFn = tokenResponse();
    const result = await completeGitHubLogin(fetchFn as unknown as typeof fetch);
    expect(result).toMatchObject({ accessToken: "ghu_x", refreshToken: "ghr_y", remember: true });
    expect(result!.expiresAt).toBeGreaterThan(Date.now());
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/devices");
    expect(JSON.parse(String(fetchFn.mock.calls[0]![1]!.body))).toEqual({ code: "abc" });
  });

  it("rejects a forged callback (state mismatch) without calling the helper", async () => {
    sessionStorage.setItem("dim-oauth-state", JSON.stringify({ state: "real" }));
    window.history.replaceState(null, "", "/?code=abc&state=forged");
    const fetchFn = tokenResponse();
    await expect(completeGitHubLogin(fetchFn as unknown as typeof fetch)).rejects.toBeInstanceOf(OAuthError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports when the user cancels on GitHub", async () => {
    window.history.replaceState(null, "", "/?error=access_denied&state=s1");
    await expect(completeGitHubLogin(tokenResponse() as unknown as typeof fetch)).rejects.toThrow(/cancelled/);
  });

  it("renews an expiring token and stores the new one", async () => {
    const session: GitHubSession = { token: "old", login: "u", canWrite: true, refreshToken: "ghr_old", expiresAt: Date.now() + 10_000, remember: false };
    const refresh = vi.fn(async () => ({ accessToken: "new", refreshToken: "ghr_new", expiresAt: Date.now() + 28_800_000 }));
    await ensureFreshSession(session, refresh);
    expect(refresh).toHaveBeenCalledWith("ghr_old");
    expect(session).toMatchObject({ token: "new", refreshToken: "ghr_new" });
    expect(readStoredCredentials()).toMatchObject({ accessToken: "new", refreshToken: "ghr_new", remember: false });
  });

  it("does not refresh a token that is still valid", async () => {
    const session: GitHubSession = { token: "t", login: "u", canWrite: true, refreshToken: "r", expiresAt: Date.now() + 3_600_000 };
    const refresh = vi.fn();
    await ensureFreshSession(session, refresh);
    expect(refresh).not.toHaveBeenCalled();
  });
});
