import { resolve } from "path";

const API = "https://api.pocketcasts.com";
const PODCAST_API = "https://podcast-api.pocketcasts.com";
const AUTH_PATH = resolve(import.meta.dir, "auth.json");

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
    // Prefer env vars (for Railway / hosted deploys)
    if (process.env.POCKETCASTS_ACCESS_TOKEN && process.env.POCKETCASTS_REFRESH_TOKEN) {
      this.accessToken = process.env.POCKETCASTS_ACCESS_TOKEN;
      this.refreshTokenValue = process.env.POCKETCASTS_REFRESH_TOKEN;
      this.expiresAt = parseInt(process.env.POCKETCASTS_EXPIRES_AT || "0", 10);
      return true;
    }
    // Fall back to local auth.json
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
    // Try loading from disk if we have nothing in memory
    if (!this.accessToken && !this.refreshTokenValue) {
      await this.loadAuth();
    }
    // Still valid
    if (this.accessToken && Date.now() < this.expiresAt) return;
    // Expired but we can refresh
    if (this.refreshTokenValue) {
      await this.refresh();
      return;
    }
    // No tokens at all
    throw new Error("Not logged in. Run `bun run login` first.");
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
      if(episode.uuid === episodeUuid) {
        return episode.pocket_casts_transcripts
      }
    }
  }

  async getTranscript(episodeUuid: string) {
    const episode: any = await this.getEpisodeDetails(episodeUuid);
    console.log(episode)

    if(!episode?.podcastUuid) {
      throw new Error(`Failed to fetch podcast UUID for episode ${episodeUuid}`);
    }

    const transcripts = await this.getPodcastTranscript(episode.podcastUuid, episode.uuid);
    console.log(transcripts)
    const vtt = transcripts?.find(
      (t: any) => t.type === "text/vtt"
    )?.url;
    if (!vtt) throw new Error("No transcript available for this episode");
    const res = await fetch(vtt, { headers: defaultHeaders });
    if (!res.ok) throw new Error(`Failed to fetch transcript: ${res.status}`);
    return res.text();
  }
}

export const pocketcasts = new PocketCastsClient();
