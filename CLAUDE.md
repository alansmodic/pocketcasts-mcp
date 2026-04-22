# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A Pocket Casts MCP (Model Context Protocol) server built with [fastmcp](https://github.com/punkpeye/fastmcp) and Bun. Exposes Pocket Casts podcast data (new episodes, episode details, transcripts) as MCP tools over HTTP stream transport. Deployable to Railway via Docker.

## Commands

```bash
bun install          # Install dependencies
bun run start        # Start MCP server (index.ts)
bun run login        # Interactive login to Pocket Casts (saves auth.json)
```

## Architecture

- **index.ts** — MCP server entry point. Registers tools (`new-episodes`, `get-episode`, `get-transcript`) via fastmcp, handles bearer token auth via `MCP_API_KEY` env var, listens on `PORT` (default 3001).
- **pocketcasts.ts** — `PocketCastsClient` class. Handles Pocket Casts API auth (login, token refresh, auto-reload from `auth.json` or env vars), episode fetching, transcript retrieval. Falls back to OpenAI Whisper for transcription when no transcript exists.
- **login.ts** — Interactive CLI script to authenticate with Pocket Casts and persist tokens to `auth.json`.

## Environment variables

- `MCP_API_KEY` (required) — Bearer token for authenticating MCP clients
- `POCKETCASTS_ACCESS_TOKEN`, `POCKETCASTS_REFRESH_TOKEN`, `POCKETCASTS_EXPIRES_AT` — For hosted deploys (alternative to `auth.json`)
- `OPENAI_API_KEY` — Optional, enables Whisper transcription fallback
- `PORT` — Server port (default 3001)

## Bun conventions

Default to Bun for everything. Use `bun` instead of `node`/`ts-node`, `bun install` instead of `npm install`, `bun test` instead of `jest`. Bun auto-loads `.env` — no dotenv needed. Prefer `Bun.file`/`Bun.write` over `node:fs`. Use `Bun.$` for shell commands instead of execa.
