# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A multi-user Pocket Casts MCP (Model Context Protocol) server built with [fastmcp](https://github.com/punkpeye/fastmcp) and Bun. Each user enrolls their own Pocket Casts account; the server stores their session tokens (encrypted) keyed to a per-user bearer token and routes every request to that user's account. Exposes Pocket Casts podcast data (subscriptions, episodes, transcripts) as MCP tools over HTTP stream transport. Deployable to Railway via Docker with a Postgres plugin.

## Commands

```bash
bun install          # Install dependencies
bun run start        # Start server (enrollment form + MCP endpoint on PORT)
bun run login        # Enroll yourself against a running server (POSTs to /enroll)
```

## Architecture

- **index.ts** — Entry point. Starts FastMCP on a loopback port (`MCP_INTERNAL_PORT`, default 3101) and a public `Bun.serve` on `PORT` (default 3001) that fronts it. The public server handles management routes (enrollment form, `/enroll`, `/creds`) via `handleManagement` and proxies everything else (e.g. `/mcp`) to FastMCP — so Railway's single exposed port covers both. FastMCP's `authenticate` resolves the inbound bearer to a stored user, decrypts their tokens, and attaches a per-user `PocketCastsClient` as the session. Tools read `(session as Session).client`.
- **pocketcasts.ts** — `PocketCastsClient` class, one instance per user. Token state is injected via the constructor; an `onTokens` callback fires on login and auto-refresh so the caller can re-encrypt and persist the new tokens. Handles episode fetching and transcript retrieval, with AssemblyAI as a transcription fallback.
- **enroll.ts** — `handleManagement`: serves the enrollment form, handles `POST /enroll` (verifies Pocket Casts credentials by logging in, stores encrypted tokens, mints a bearer) and `DELETE /creds` (deletes by bearer hash). Includes an in-memory rate limiter on `/enroll`.
- **enroll.html** — Static self-service enrollment form posted to `/enroll`.
- **crypto.ts** — AES-256-GCM `seal`/`open` (master key from `ENCRYPTION_KEY`), `sha256` (bearer fingerprinting), `mintBearer`.
- **db.ts** — Postgres user store via Bun's built-in `SQL`. One row per user: `token_hash`, `pc_email`, encrypted `enc_tokens`. Enrollment is keyed by email (re-enrolling rotates the bearer).
- **login.ts** — Terminal helper that POSTs to a running server's `/enroll`.

## Security model

- Passwords are used only for the one-time login at enrollment and never stored.
- Pocket Casts session tokens are encrypted at rest (AES-256-GCM) with `ENCRYPTION_KEY`.
- Bearer tokens are stored only as SHA-256 hashes.
- `/enroll` carries a plaintext password over the wire — TLS is mandatory in production (Railway provides it).

## Environment variables

- `DATABASE_URL` (required) — Postgres connection string (Railway Postgres plugin provides this)
- `ENCRYPTION_KEY` (required) — 32 bytes base64 (`openssl rand -base64 32`); encrypts stored sessions. Keep stable; rotating it invalidates all stored sessions.
- `ASSEMBLYAI_API_KEY` — Optional, enables transcription fallback
- `PORT` — Public server port (default 3001; Railway sets this)
- `MCP_INTERNAL_PORT` — Loopback port FastMCP binds to (default 3101)

## Bun conventions

Default to Bun for everything. Use `bun` instead of `node`/`ts-node`, `bun install` instead of `npm install`, `bun test` instead of `jest`. Bun auto-loads `.env` — no dotenv needed. Prefer `Bun.file`/`Bun.write` over `node:fs`. Use `Bun.$` for shell commands instead of execa. Postgres uses Bun's built-in `SQL` (no `pg` dependency).
