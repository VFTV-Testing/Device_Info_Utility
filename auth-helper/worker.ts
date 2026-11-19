/**
 * Cloudflare Workers entry point. Deploy with `npm run build:auth-helper` and paste
 * dist-auth-helper/worker.js into a Worker, or use `npx wrangler deploy` (see README).
 * Settings (Worker → Settings → Variables): GITHUB_CLIENT_ID, ALLOWED_ORIGINS,
 * and GITHUB_CLIENT_SECRET as an encrypted Secret.
 */
import { handleAuthRequest, type AuthHelperEnv } from "./handler";

export default {
  fetch(request: Request, env: AuthHelperEnv): Promise<Response> {
    return handleAuthRequest(request, env);
  },
};
