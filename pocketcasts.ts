import { resolve } from "path";

const API = "https://api.pocketcasts.com";
const PODCAST_API = "https://podcast-api.pocketcasts.com";
const AUTH_PATH = resolve(process.env.AUTH_DIR || import.meta.dir, "auth.json");

const defaultHeaders: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
  Referer: "https://www.pocketcasts.com/",
};

type StoredAuth = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

class PocketCastsClient {
  private accessToken = "";
  private refreshTokenValue = "";
  private expiresAt = 0;
  private async saveAuth() {
    const data: StoredAuth = {
      accessToken: this.accessToken,
      refreshToken: this.refreshTokenValue,
      expiresAt: this.expiresAt,
    };
    await Bun.write(AUTH_PATH, JSON.stringify(data, null, 2));
  }

  private async loadAuth(): Promise<boolean> {
    // 1. Try env vars (survive Railway redeploys)
    const envToken = process.env.POCKETCASTS_ACCESS_TOKEN;
    const envRefresh = process.env.POCKETCASTS_REFRESH_TOKEN;
    const envExpires = process.env.POCKETCASTS_EXPIRES_AT;
    if (envToken && envRefresh) {
      this.accessToken = envToken;
      this.refreshTokenValue = envRefresh;
      this.expiresAt = envExpires ? parseInt(envExpires, 10) : 0;
      return true;
    }

    // 2. Try local auth.json (survives process restarts, lost on redeploy without a volume)
    const file = Bun.file(AUTH_PATH);
    if (!(await file.exists())) return false;
    try {
      const data: StoredAuth = await file.json();
      this.accessToken = data.accessToken;
      this.refreshTokenValue = data.refreshToken;
      this.expiresAt = data.expiresAt;
      return true;
    } catch {
      return false;
    }
  }

  private async ensureAuth() {
    // Still valid
    if (this.accessToken && Date.now() < this.expiresAt) return;
    // Expired but we can refresh
    if (this.refreshTokenValue) {
      await this.refresh();
      return;
    }
    // Try loading from disk
    if (await this.loadAuth()) {
      if (this.accessToken && Date.now() < this.expiresAt) return;
      if (this.refreshTokenValue) {
        await this.refresh();
        return;
      }
    }
    // Login with email/password from env vars (Railway / hosted deploys)
    const email = process.env.POCKETCASTS_EMAIL;
    const password = process.env.POCKETCASTS_PASSWORD;
    if (email && password) {
      await this.login(email, password);
      return;
    }
    // No way to authenticate
    throw new Error("Not logged in. Run `bun run login` or set POCKETCASTS_EMAIL and POCKETCASTS_PASSWORD env vars.");
  }

  async login(email: string, password: string) {
    const res = await fetch(`${API}/user/login_pocket_casts`, {
      method: "POST",
      headers: { ...defaultHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, scope: "webplayer" }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const data: any = await res.json();
    this.accessToken = data.accessToken;
    this.refreshTokenValue = data.refreshToken;
    this.expiresAt = Date.now() + data.expiresIn * 1000;
    await this.saveAuth();
  }

  private async refresh() {
    const res = await fetch(`${API}/user/token`, {
      method: "POST",
      headers: {
        ...defaultHeaders,
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.refreshTokenValue}`,
      },
      body: JSON.stringify({
        grantType: "refresh_token",
        refreshToken: this.refreshTokenValue,
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data: any = await res.json();
    this.accessToken = data.accessToken;
    this.refreshTokenValue = data.refreshToken;
    this.expiresAt = Date.now() + data.expiresIn * 1000;
    await this.saveAuth();
  }

  private async authedPost(path: string, body?: unknown) {
    await this.ensureAuth();
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        ...defaultHeaders,
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
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
          Authorization: `Bearer ${this.accessToken}`,
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
    const body = await res.json();

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

export const pocketcasts = new PocketCastsClient();
