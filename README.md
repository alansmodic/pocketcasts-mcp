# Pocket Casts MCP Server

An [MCP](https://modelcontextprotocol.io) server that connects AI assistants to your [Pocket Casts](https://pocketcasts.com) account. Browse your subscriptions, read episode details, and retrieve transcripts — with automatic transcription via [AssemblyAI](https://www.assemblyai.com) when no native transcript exists.

Built with [Bun](https://bun.com) and [FastMCP](https://github.com/punkpeye/fastmcp). Deployable to [Railway](https://railway.app) or any Docker host.

## Tools

| Tool | Description |
|---|---|
| `list-podcasts` | List all subscribed podcasts (includes folder UUIDs) |
| `new-episodes` | Get recent episodes from your subscriptions |
| `get-episode` | Get details about a specific episode by UUID |
| `get-transcript` | Get an episode's transcript (falls back to AssemblyAI if none exists) |
| `check-transcripts` | Check transcript availability across all podcasts or a specific folder |

## Setup

### Prerequisites

- [Bun](https://bun.com) v1.3+
- A [Pocket Casts](https://pocketcasts.com) account (Plus required for API access)

### Install and authenticate

```bash
bun install
bun run login
```

The login command will prompt for your Pocket Casts email and password, then save tokens to `auth.json`.

### Configure environment

Create a `.env` file:

```
MCP_API_KEY=your-secret-key-here
ASSEMBLYAI_API_KEY=your-assemblyai-key    # optional, enables transcription fallback
```

### Run

```bash
bun run start
```

The server starts on port 3001 (override with `PORT` env var) using HTTP stream transport.

## Connecting to an MCP client

Point your MCP client at:

```
http://localhost:3001/mcp
```

Authenticate with either:
- `Authorization: Bearer <MCP_API_KEY>` header
- `?api_key=<MCP_API_KEY>` query parameter

## Deploy to Railway

The included `Dockerfile` is Railway-ready. Set these environment variables in your Railway project:

| Variable | Required | Description |
|---|---|---|
| `MCP_API_KEY` | Yes | Bearer token for MCP client auth |
| `POCKETCASTS_ACCESS_TOKEN` | Yes | From `auth.json` after login |
| `POCKETCASTS_REFRESH_TOKEN` | Yes | From `auth.json` after login |
| `POCKETCASTS_EXPIRES_AT` | Yes | From `auth.json` after login |
| `ASSEMBLYAI_API_KEY` | No | Enables transcription for episodes without native transcripts |
| `PORT` | No | Railway sets this automatically |

## How transcripts work

1. Checks for Pocket Casts-generated transcripts first
2. Falls back to RSS-sourced transcripts if available
3. If neither exists and `ASSEMBLYAI_API_KEY` is set, submits the audio URL directly to AssemblyAI for transcription (no file download required)
