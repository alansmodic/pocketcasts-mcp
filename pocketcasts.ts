const API = "https://api.pocketcasts.com";
const PODCAST_API = "https://podcast-api.pocketcasts.com";

const defaultHeaders: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
  Referer: "https://www.pocketcasts.com/",
};

export type StoredAuth = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

/** What `authenticate` attaches to each MCP session and tools read from context. */
export type Session = {
  userId: string;
  email: string;
  client: PocketCastsClient;
};

/**
 * One instance per user. Token state is injected (decrypted from the store) and
 * an `onTokens` callback is invoked whenever the tokens change — on login and on
 * auto-refresh — so the caller can re-encrypt and persist them to that user's row.
 */
export class PocketCastsClient {
  constructor(
    private tokens: StoredAuth,
    private readonly onTokens: (tokens: StoredAuth) => Promise<void> = async () => {},
  ) {}

  /** Current token state — used by enrollment to capture tokens after login. */
  get currentTokens(): StoredAuth {
    return this.tokens;
  }

  private async ensureAuth() {
    if (this.tokens.accessToken && Date.now() < this.tokens.expiresAt) return;
    if (this.tokens.refreshToken) {
      await this.refresh();
      return;
    }
    throw new Error("No valid Pocket Casts session. Please re-enroll to refresh your access.");
  }

  async login(email: string, password: string) {
    const res = await fetch(`${API}/user/login_pocket_casts`, {
      method: "POST",
      headers: { ...defaultHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, scope: "webplayer" }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const data: any = await res.json();
    this.tokens = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
    };
    await this.onTokens(this.tokens);
  }

  private async refresh() {
    const res = await fetch(`${API}/user/token`, {
      method: "POST",
      headers: {
        ...defaultHeaders,
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.tokens.refreshToken}`,
      },
      body: JSON.stringify({
        grantType: "refresh_token",
        refreshToken: this.tokens.refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data: any = await res.json();
    this.tokens = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
    };
    await this.onTokens(this.tokens);
  }

  private async authedPost(path: string, body?: unknown): Promise<any> {
    await this.ensureAuth();
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        ...defaultHeaders,
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.tokens.accessToken}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    return res.json();
  }

  async getNewReleases() {
    return this.authedPost("/user/new_releases");
  }

  async getPodcastList() {
    return this.authedPost("/user/podcast/list");
  }

  async checkTranscriptAvailability(podcastUuid: string, episodeUuid: string): Promise<{ available: boolean; types: string[] }> {
    const transcripts = await this.getPodcastTranscript(podcastUuid, episodeUuid);
    if (!transcripts || transcripts.length === 0) return { available: false, types: [] };
    return { available: true, types: transcripts.map((t: any) => t.type) };
  }

  async getEpisode(uuid: string) {
    const res = await fetch(
      `${PODCAST_API}/episode/show_notes/${uuid}`,
      { headers: defaultHeaders }
    );
    if (!res.ok)
      throw new Error(`Failed to fetch episode ${uuid}: ${res.status}`);
    return res.json();
  }

  async getEpisodeDetails(uuid: string) {
    await this.ensureAuth();
    const res = await fetch(
      `${API}/user/episode`,
      {
        method: "POST",
        headers: {
          ...defaultHeaders,
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.tokens.accessToken}`,
        },
        body: JSON.stringify({ uuid }),
      }
    );
    if (!res.ok)
      throw new Error(`Failed to fetch episode details ${uuid}: ${res.status}`);
    return res.json();
  }

  async getPodcastTranscript(podcastUuid: string, episodeUuid: string) {
    const res = await fetch(
      `${PODCAST_API}/show_notes/full/${podcastUuid}`,
      { headers: defaultHeaders }
    );
    if (!res.ok)
      throw new Error(`Failed to fetch podcast transcript ${podcastUuid}: ${res.status}`);
    const body: any = await res.json();

    for (const episode of body.podcast.episodes) {
      if (episode.uuid === episodeUuid) {
        // Prefer Pocket Casts-generated transcripts, fall back to RSS-sourced ones
        if (episode.pocket_casts_transcripts?.length) return episode.pocket_casts_transcripts;
        if (episode.transcripts?.length) return episode.transcripts;
        return null;
      }
    }
    return null;
  }

  private async transcribeWithAssemblyAI(audioUrl: string): Promise<string> {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey)
      throw new Error(
        "No transcript available and ASSEMBLYAI_API_KEY is not set. " +
        "Set ASSEMBLYAI_API_KEY to enable transcription as a fallback."
      );

    console.error(`[AssemblyAI] Submitting transcription job...`);
    const headers = { Authorization: apiKey, "Content-Type": "application/json" };

    const submitRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers,
      body: JSON.stringify({ audio_url: audioUrl, speech_models: ["universal-2"] }),
    });
    if (!submitRes.ok) throw new Error(`AssemblyAI submit failed: ${submitRes.status} ${await submitRes.text()}`);
    const { id } = await submitRes.json() as { id: string };

    console.error(`[AssemblyAI] Waiting for transcript ${id}...`);
    while (true) {
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers });
      if (!pollRes.ok) throw new Error(`AssemblyAI poll failed: ${pollRes.status}`);
      const result = await pollRes.json() as { status: string; text?: string; error?: string };

      if (result.status === "completed") return result.text!;
      if (result.status === "error") throw new Error(`AssemblyAI error: ${result.error}`);

      await Bun.sleep(3000);
    }
  }

  async getTranscript(episodeUuid: string): Promise<string> {
    const episode: any = await this.getEpisodeDetails(episodeUuid);

    if (!episode?.podcastUuid) {
      throw new Error(`Failed to fetch podcast UUID for episode ${episodeUuid}`);
    }

    const transcripts = await this.getPodcastTranscript(episode.podcastUuid, episode.uuid);
    const vttUrl = transcripts?.find((t: any) => t.type === "text/vtt")?.url;

    if (vttUrl) {
      const res = await fetch(vttUrl, { headers: defaultHeaders });
      if (!res.ok) throw new Error(`Failed to fetch transcript: ${res.status}`);
      return res.text();
    }

    // No pre-made transcript — fall back to AssemblyAI
    if (!episode.url) throw new Error("No audio URL available for transcription");
    return this.transcribeWithAssemblyAI(episode.url);
  }
}
