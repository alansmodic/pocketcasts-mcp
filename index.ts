import { FastMCP } from "fastmcp";
import { z } from "zod";
import { PocketCastsClient, type Session } from "./pocketcasts";
import { initDb, findByTokenHash, updateTokens, deleteById } from "./db";
import { sha256, seal, open } from "./crypto";
import { handleManagement } from "./enroll";

await initDb();

const server = new FastMCP({
  name: "pocketcasts",
  version: "0.2.0",
  // Per-user routing: resolve the inbound bearer to a stored user, decrypt their
  // Pocket Casts session, and hand each request its own client. Runs on every
  // request (stateless transport), so it's the natural place to route.
  authenticate: async (req): Promise<Session> => {
    const header = req.headers.authorization;
    let bearer = "";
    if (header?.startsWith("Bearer ")) {
      bearer = header.slice(7);
    } else {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      bearer = url.searchParams.get("api_key") ?? "";
    }
    if (!bearer) throw new Response("Unauthorized", { status: 401 });

    const row = await findByTokenHash(await sha256(bearer));
    if (!row) throw new Response("Unauthorized", { status: 401 });

    const tokens = JSON.parse(await open(row.enc_tokens));
    const client = new PocketCastsClient(tokens, async (refreshed) => {
      // Persist refreshed tokens back to this user's row (re-encrypted).
      await updateTokens(row.id, await seal(JSON.stringify(refreshed)));
    });
    return { userId: row.id, email: row.pc_email, client };
  },
});

server.addTool({
  name: "new-episodes",
  description: "Get new/recent podcast episodes from your subscriptions",
  execute: async (_args, { session }) => {
    const data = await (session as Session).client.getNewReleases();
    return JSON.stringify(data, null, 2);
  },
});

server.addTool({
  name: "get-episode",
  description: "Get details about a specific podcast episode",
  parameters: z.object({
    uuid: z.string().describe("The UUID of the episode"),
  }),
  execute: async ({ uuid }, { session }) => {
    const data = await (session as Session).client.getEpisode(uuid);
    return JSON.stringify(data, null, 2);
  },
});

server.addTool({
  name: "get-transcript",
  description: "Get the transcript for a podcast episode",
  parameters: z.object({
    uuid: z.string().describe("The UUID of the episode"),
  }),
  execute: async ({ uuid }, { session }) => {
    return await (session as Session).client.getTranscript(uuid);
  },
});

server.addTool({
  name: "list-podcasts",
  description: "List all subscribed podcasts",
  execute: async (_args, { session }) => {
    const data = await (session as Session).client.getPodcastList();
    return JSON.stringify(data, null, 2);
  },
});

server.addTool({
  name: "check-transcripts",
  description: "Check transcript availability for podcasts in a folder (by folder UUID) or all podcasts",
  parameters: z.object({
    folderUuid: z.string().optional().describe("Filter to podcasts in this folder UUID. Omit to check all."),
  }),
  execute: async ({ folderUuid }, { session }) => {
    const client = (session as Session).client;
    const { podcasts } = await client.getPodcastList();
    const filtered = folderUuid
      ? podcasts.filter((p: any) => p.folderUuid === folderUuid)
      : podcasts;

    const results = await Promise.all(
      filtered.map(async (p: any) => {
        try {
          const transcript = await client.checkTranscriptAvailability(p.uuid, p.lastEpisodeUuid);
          return { title: p.title, uuid: p.uuid, ...transcript };
        } catch (e: any) {
          return { title: p.title, uuid: p.uuid, available: false, types: [], error: e.message };
        }
      })
    );
    return JSON.stringify(results, null, 2);
  },
});

server.addTool({
  name: "whoami",
  description: "Show which Pocket Casts account this access token is connected to",
  execute: async (_args, { session }) => {
    return `Connected as ${(session as Session).email}`;
  },
});

server.addTool({
  name: "delete-my-account",
  description: "Delete your stored Pocket Casts credentials from this server. This revokes your access token and removes your encrypted session. Irreversible — you'd need to re-enroll to reconnect.",
  execute: async (_args, { session }) => {
    const removed = await deleteById((session as Session).userId);
    return removed > 0
      ? "Your stored credentials have been deleted and your access token is now revoked."
      : "No stored credentials were found for your account.";
  },
});

// FastMCP listens only on loopback; the public front server below proxies to it.
const PUBLIC_PORT = parseInt(process.env.PORT || "3001", 10);
const MCP_INTERNAL_PORT = parseInt(process.env.MCP_INTERNAL_PORT || "3101", 10);

await server.start({
  transportType: "httpStream",
  httpStream: {
    port: MCP_INTERNAL_PORT,
    host: "127.0.0.1",
    stateless: true,
  },
});

// Single public server: management routes (enrollment form, /enroll, /creds) are
// handled here; everything else is proxied to the MCP transport. This keeps one
// public URL/origin on Railway, which exposes a single port per service.
Bun.serve({
  port: PUBLIC_PORT,
  hostname: "0.0.0.0",
  idleTimeout: 0, // don't cut long-lived MCP streams
  async fetch(req, srv) {
    const managed = await handleManagement(req, srv);
    if (managed) return managed;

    const url = new URL(req.url);
    const target = `http://127.0.0.1:${MCP_INTERNAL_PORT}${url.pathname}${url.search}`;
    return fetch(target, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      // Stream request bodies through to the MCP transport.
      duplex: "half",
    });
  },
});

console.log(`Pocket Casts MCP server listening on port ${PUBLIC_PORT}`);
console.log(`  • Enrollment form:  /         (and POST /enroll)`);
console.log(`  • MCP endpoint:     /mcp       (Bearer <your token>)`);
