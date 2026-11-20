import { createContext, useContext } from "react";

export interface ModeratorValue {
  /** Name the moderator gave at sign-in (shown in the header and saved with each update). */
  name: string;
  signOut: () => void;
}

/** Provided only while someone is signed in with the shared moderator key. */
export const ModeratorContext = createContext<ModeratorValue | null>(null);

export function useModerator(): ModeratorValue | null {
  return useContext(ModeratorContext);
}
