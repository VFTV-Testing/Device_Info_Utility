import { createHash } from "node:crypto";

/**
 * In-memory imitation of the GitHub REST "contents" API, faithful to the
 * behaviours the app relies on: base64 content, blob SHAs, 409 on stale SHA,
 * 422 when creating over an existing file, 401/403 errors.
 */
export interface FakeGitHubOptions {
  owner?: string;
  repo?: string;
  branch?: string;
  path?: string;
  initialText?: string | null;
}

export class FakeGitHub {
  text: string | null;
  sha: string | null;
  commits: Array<{ message: string; sha: string; text: string }> = [];
  requests: Array<{ method: string; url: string; body?: unknown; auth?: string | null }> = [];
  failure: null | "auth" | "rate-limit" | "forbidden" | "network" | "server" = null;
  /** Runs right before a PUT is applied — use it to simulate another user's commit. */
  beforePut?: () => void;
  /** What GET /repos/{owner}/{repo} reports as the signed-in user's push permission. */
  canPush = true;

  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly path: string;

  constructor(options: FakeGitHubOptions = {}) {
    this.owner = options.owner ?? "acme";
    this.repo = options.repo ?? "devices";
    this.branch = options.branch ?? "main";
    this.path = options.path ?? "deviceInformation.json";
    this.text = options.initialText === undefined ? "{}\n" : options.initialText;
    this.sha = this.text === null ? null : FakeGitHub.blobSha(this.text);
  }

  static blobSha(text: string): string {
    return createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex");
  }

  /** Simulates a commit made by someone else (e.g. another user of the app). */
  externalCommit(text: string): void {
    this.text = text;
    this.sha = FakeGitHub.blobSha(text);
    this.commits.push({ message: "external commit", sha: `ext${this.commits.length}`, text });
  }

  private json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.requests.push({ method, url: url.pathname + url.search, body, auth: headers.get("authorization") });

    if (method === "PUT") this.beforePut?.();
    if (this.failure === "network") throw new TypeError("fetch failed");
    if (this.failure === "auth") return this.json(401, { message: "Bad credentials" });
    if (this.failure === "rate-limit") {
      return this.json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" });
    }
    if (this.failure === "forbidden") return this.json(403, { message: "Resource not accessible by integration" });
    if (this.failure === "server") return this.json(502, { message: "Server Error" });

    const repoPath = `/repos/${this.owner}/${this.repo}`;
    const contentsPath = `${repoPath}/contents/${this.path}`;

    if (method === "GET" && url.pathname === "/user") return this.json(200, { login: "tester", name: "Test User", avatar_url: "" });
    if (method === "GET" && url.pathname === repoPath) {
      return this.json(200, { full_name: `${this.owner}/${this.repo}`, permissions: { pull: true, push: this.canPush } });
    }
    if (method === "GET" && url.pathname === `${repoPath}/branches/${this.branch}`) return this.json(200, { name: this.branch });
    if (method === "GET" && url.pathname.startsWith(`${repoPath}/branches/`)) return this.json(404, { message: "Branch not found" });

    if (url.pathname === contentsPath && method === "GET") {
      if (url.searchParams.get("ref") !== this.branch) return this.json(404, { message: "No commit found for the ref" });
      if (this.text === null) return this.json(404, { message: "Not Found" });
      const content = Buffer.from(this.text).toString("base64").replace(/(.{60})/g, "$1\n");
      return this.json(200, { type: "file", sha: this.sha, size: this.text.length, encoding: "base64", content });
    }

    if (url.pathname === contentsPath && method === "PUT") {
      const { sha, content, message, branch } = body as { sha?: string; content: string; message: string; branch: string };
      if (branch !== this.branch) return this.json(404, { message: "Branch not found" });
      if (this.text !== null && !sha) return this.json(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
      if (this.text !== null && sha !== this.sha) return this.json(409, { message: `${this.path} does not match ${sha}` });
      const text = Buffer.from(content, "base64").toString("utf8");
      const created = this.text === null;
      this.text = text;
      this.sha = FakeGitHub.blobSha(text);
      const commitSha = createHash("sha1").update(`commit${this.commits.length}${text}`).digest("hex");
      this.commits.push({ message, sha: commitSha, text });
      return this.json(created ? 201 : 200, {
        content: { sha: this.sha, path: this.path },
        commit: { sha: commitSha, html_url: `https://github.com/${this.owner}/${this.repo}/commit/${commitSha}` },
      });
    }

    return this.json(404, { message: "Not Found" });
  };
}
