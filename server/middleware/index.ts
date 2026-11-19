import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../shared/errors";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Optional HTTP Basic authentication for the whole app (UI + API).
 * Enabled when APP_BASIC_AUTH_USER / APP_BASIC_AUTH_PASSWORD are set.
 * For SSO, put the app behind your identity-aware proxy instead (see README).
 */
export function basicAuth(credentials: { user: string; password: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      const user = decoded.slice(0, sep);
      const password = decoded.slice(sep + 1);
      if (sep > 0 && safeEqual(user, credentials.user) && safeEqual(password, credentials.password)) {
        res.locals.user = user;
        return next();
      }
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="Device Information Manager", charset="UTF-8"');
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Sign-in required." } });
  };
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  );
  next();
}

export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

/** Converts every error into a safe JSON response — no stack traces or secrets leak to the client. */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  const status = (error as { status?: number; type?: string })?.status;
  if (status === 400 || (error as { type?: string })?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "The request body is not valid JSON." } });
    return;
  }
  if (status === 413) {
    res.status(413).json({ error: { code: "BAD_REQUEST", message: "The request is too large." } });
    return;
  }
  console.error("[server] Unexpected error:", error);
  res.status(500).json({ error: { code: "INTERNAL", message: "An unexpected server error occurred." } });
}
