/**
 * Cloudflare Workers entry point. Deploy with `npm run build:auth-helper` and paste
 * dist-auth-helper/worker.js into a Worker, or use `npx wrangler deploy` (see README).
 * Settings (Worker → Settings → Variables): GITHUB_CLIENT_ID, ALLOWED_ORIGINS,
 * and GITHUB_CLIENT_SECRET as an encrypted Secret.
 * Moderator access (optional): MODERATOR_KEY, GITHUB_APP_PRIVATE_KEY as Secrets;
 * GITHUB_APP_ID and GITHUB_APP_INSTALLATION_ID as plain variables.
 */
import { handleAuthRequest, type AuthHelperEnv } from "./handler";

export default {
  fetch(request: Request, env: AuthHelperEnv): Promise<Response> {
    return handleAuthRequest(request, env);
  },
};
