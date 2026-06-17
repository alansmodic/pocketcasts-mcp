// Self-service enrollment + credential deletion.
//
// These routes are served on the public port (see index.ts) alongside the MCP
// transport. A user submits their own Pocket Casts email/password once; we prove
// the credentials by logging in, then store only the resulting session tokens
// (encrypted) and hand back a bearer token. The password is never stored.

import { PocketCastsClient } from "./pocketcasts";
import { mintBearer, seal, sha256 } from "./crypto";
import { upsertUser, deleteByTokenHash } from "./db";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Simple in-memory fixed-window rate limiter for the unauthenticated /enroll POST,
// so it can't be used to relay credential-stuffing at Pocket Casts. Keyed by client IP.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clientIp(req: Request, server: Bun.Server<undefined>): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return server.requestIP(req)?.address ?? "unknown";
}

const formHtml = await Bun.file(new URL("./enroll.html", import.meta.url)).text();

/**
 * Handle a management route. Returns a Response for enrollment/deletion/form
 * requests, or `null` if the request is not a management route (so the caller
 * can forward it to the MCP transport).
 */
export async function handleManagement(req: Request, server: Bun.Server<undefined>): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Enrollment form (served at "/" and GET /enroll).
  if (req.method === "GET" && (path === "/" || path === "/enroll")) {
    return new Response(formHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // Enroll: prove Pocket Casts credentials, store encrypted tokens, mint a bearer.
  if (req.method === "POST" && path === "/enroll") {
    const ip = clientIp(req, server);
    if (rateLimited(ip)) {
      return json({ error: "Too many enrollment attempts. Try again in a few minutes." }, 429);
    }

    let email: string, password: string;
    try {
      const body = (await req.json()) as { email?: string; password?: string };
      email = (body.email ?? "").trim();
      password = body.password ?? "";
    } catch {
      return json({ error: "Invalid request body." }, 400);
    }
    if (!email || !password) {
      return json({ error: "Email and password are required." }, 400);
    }

    const client = new PocketCastsClient({ accessToken: "", refreshToken: "", expiresAt: 0 });
    try {
      await client.login(email, password); // throws on bad credentials
    } catch {
      return json({ error: "Login failed. Check your Pocket Casts email and password." }, 401);
    }

    const bearer = mintBearer();
    await upsertUser({
      email,
      tokenHash: await sha256(bearer),
      encTokens: await seal(JSON.stringify(client.currentTokens)),
    });
    // Password is now out of scope and never persisted.
    return json({ bearer }, 201);
  }

  // Delete my credentials: wipe the row for the supplied bearer.
  if (req.method === "DELETE" && path === "/creds") {
    const header = req.headers.get("authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!bearer) return json({ error: "Bearer token required." }, 401);
    const removed = await deleteByTokenHash(await sha256(bearer));
    return json({ deleted: removed > 0 }, removed > 0 ? 200 : 404);
  }

  return null;
}
