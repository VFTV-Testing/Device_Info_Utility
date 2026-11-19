import { createContext, useContext } from "react";
import type { GitHubSession } from "../services/githubSession";

export interface AuthValue {
  session: GitHubSession;
  signOut: () => void;
}

/** Only provided in browser-only (github-direct) mode. */
export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue | null {
  return useContext(AuthContext);
}
