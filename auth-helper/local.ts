/**
 * Runs the sign-in helper on this computer for testing: `npm run auth-helper`.
 * Reads OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET / OAUTH_ALLOWED_ORIGINS / OAUTH_HELPER_PORT from .env.
 */
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { handleAuthRequest } from "./handler";

if (existsSync(".env")) process.loadEnvFile(".env");

const env = {
  GITHUB_CLIENT_ID: process.env.OAUTH_CLIENT_ID ?? "",
  GITHUB_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET ?? "",
  ALLOWED_ORIGINS: process.env.OAUTH_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:4321",
};
const port = Number(process.env.OAUTH_HELPER_PORT) || 8787;

if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
  console.error("\nSet OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in .env (from your GitHub App settings).\n");
  process.exit(1);
}

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" ? undefined : Buffer.concat(chunks),
  });
  const response = await handleAuthRequest(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => {
  console.log(`Sign-in helper listening on http://localhost:${port}  (allowed origins: ${env.ALLOWED_ORIGINS})`);
});
