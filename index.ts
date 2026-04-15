import { FastMCP } from "fastmcp";
import { z } from "zod";
import { pocketcasts } from "./pocketcasts";

const API_KEY = process.env.MCP_API_KEY;
if (!API_KEY) {
  console.error("MCP_API_KEY env var is required.");
  process.exit(1);
}

const server = new FastMCP({
  name: "pocketcasts",
  version: "0.1.0",
  authenticate: async (req) => {
    const header = req.headers.authorization;
    if (header === `Bearer ${API_KEY}`) return {};
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    if (url.searchParams.get("api_key") === API_KEY) return {};
    throw new Response("Unauthorized", { status: 401 });
  },
});

server.addTool({
  name: "new-episodes",
  description: "Get new/recent podcast episodes from your subscriptions",
  execute: async () => {
    const data = await pocketcasts.getNewReleases();
    return JSON.stringify(data, null, 2);
  },
});

server.addTool({
  name: "get-episode",
  description: "Get details about a specific podcast episode",
  parameters: z.object({
    uuid: z.string().describe("The UUID of the episode"),
  }),
  execute: async ({ uuid }) => {
    const data = await pocketcasts.getEpisode(uuid);
    return JSON.stringify(data, null, 2);
  },
});

server.addTool({
  name: "get-transcript",
  description: "Get the transcript for a podcast episode",
  parameters: z.object({
    uuid: z.string().describe("The UUID of the episode"),
  }),
  execute: async ({ uuid }) => {
    return await pocketcasts.getTranscript(uuid);
  },
});

const port = parseInt(process.env.PORT || "3001", 10);

server.start({
  transportType: "httpStream",
  httpStream: {
    port,
    stateless: true,
  },
});

console.log(`Pocket Casts MCP server listening on port ${port}`);
