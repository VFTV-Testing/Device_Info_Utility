/**
 * One-time "Welcome, <name> !!" toast after a fresh sign-in.
 * The sign-in page queues the name; the app shell shows it once and clears it,
 * so a restored session or a page refresh does not greet again.
 */
export type WelcomeVia = "github" | "passkey";

export interface Welcome {
  name: string;
  via: WelcomeVia;
}

let pending: Welcome | null = null;

/** First word of a display name ("Ganesh Biyyapu" → "Ganesh"); falls back to the whole value. */
export function firstName(name: string): string {
  const trimmed = name.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}

export function queueWelcome(name: string, via: WelcomeVia): void {
  const first = firstName(name);
  pending = first ? { name: first, via } : null;
}

/** Returns the queued greeting once, then forgets it. */
export function takeWelcome(): Welcome | null {
  const welcome = pending;
  pending = null;
  return welcome;
}
