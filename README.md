# Pocket Casts MCP Server

An [MCP](https://modelcontextprotocol.io) server that connects AI assistants to your [Pocket Casts](https://pocketcasts.com) account. Browse your subscriptions, read episode details, and retrieve transcripts — with automatic transcription via [AssemblyAI](https://www.assemblyai.com) when no native transcript exists.

Built with [Bun](https://bun.com) and [FastMCP](https://github.com/punkpeye/fastmcp). Deployable to [Railway](https://railway.app) or any Docker host.

**Multi-user.** Each person connects their *own* Pocket Casts account through a one-time enrollment, gets a private access token, and only ever sees their own podcasts. No shared account, and the server never stores anyone's password.

## Tools

| Tool | Description |
|---|---|
| `list-podcasts` | List all subscribed podcasts (includes folder UUIDs) |
| `new-episodes` | Get recent episodes from your subscriptions |
| `get-episode` | Get details about a specific episode by UUID |
| `get-transcript` | Get an episode's transcript (falls back to AssemblyAI if none exists) |
| `check-transcripts` | Check transcript availability across all podcasts or a specific folder |
| `whoami` | Show which Pocket Casts account the access token is connected to |
| `delete-my-account` | Delete your stored credentials and revoke your access token |

## How auth works

1. A user opens the server root in a browser and submits their own Pocket Casts email + password (one time).
2. The server logs in to Pocket Casts to verify the credentials, then stores only the resulting **session tokens** — encrypted at rest with AES-256-GCM — keyed to a freshly minted **bearer token**.
3. The password is discarded immediately and never stored. The bearer token is shown to the user once.
4. The user puts that bearer token in their MCP client. Every request is routed to that user's own Pocket Casts session; tokens auto-refresh and are re-encrypted in place.

Bearer tokens are stored only as SHA-256 hashes, so a database leak yields no usable credentials without the `ENCRYPTION_KEY`.

## Enrolling

**Web form (recommended):** open the server's root URL (e.g. `https://your-app.railway.app/`), enter your Pocket Casts login, and copy the access token it returns.

**Terminal:** with the server running,

```bash
ENROLL_URL=https://your-app.railway.app bun run login
```

**Delete your credentials:** either run the `delete-my-account` tool from your assistant, or:

```bash
curl -X DELETE https://your-app.railway.app/creds -H "Authorization: Bearer <your-token>"
```

## Connecting an MCP client

Point your MCP client at:

```
https://your-app.railway.app/mcp
```

Authenticate with either:
- `Authorization: Bearer <your-token>` header, or
- `?api_key=<your-token>` query parameter

## Local development

### Prerequisites

- [Bun](https://bun.com) v1.3+
- A Postgres database (`DATABASE_URL`)
- A [Pocket Casts](https://pocketcasts.com) account (Plus required for API access)

### Run

Create a `.env` file:

```
DATABASE_URL=postgres://user:pass@localhost:5432/pocketcasts
ENCRYPTION_KEY=<output of: openssl rand -base64 32>
ASSEMBLYAI_API_KEY=your-assemblyai-key    # optional, enables transcription fallback
```

Then:

```bash
bun install
bun run start          # serves enrollment form + MCP endpoint on PORT (default 3001)
bun run login          # enroll yourself from the terminal
```

## Deploy to Railway

1. Add the **Postgres** plugin to your project — it injects `DATABASE_URL` automatically.
2. Set the environment variables below.
3. The included `Dockerfile` is Railway-ready (`bun run index.ts`).

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (provided by the Railway Postgres plugin) |
| `ENCRYPTION_KEY` | Yes | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts stored sessions — **keep it stable and secret**; rotating it invalidates all stored sessions. |
| `ASSEMBLYAI_API_KEY` | No | Enables transcription for episodes without native transcripts |
| `PORT` | No | Public port; Railway sets this automatically |
| `MCP_INTERNAL_PORT` | No | Loopback port FastMCP binds to behind the public proxy (default 3101) |

## How transcripts work

1. Checks for Pocket Casts-generated transcripts first
2. Falls back to RSS-sourced transcripts if available
3. If neither exists and `ASSEMBLYAI_API_KEY` is set, submits the audio URL directly to AssemblyAI for transcription (no file download required)
