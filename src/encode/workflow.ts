// Proposal step 6 (get-keys) + step 4/5 orchestration: encode-film Workflow.
// Phase A: keys are generated here instead of asked from a DRM vendor; raw keys go to KV (KEYS),
// only key IDs go to D1. The "encode" step waits for the local runner to report completion.
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { Env } from "../lib/env";

export interface EncodeParams { filmId: string; sourceKey: string }
export interface EncodeDone { ok: boolean; error?: string; runner?: string }

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const retry = { retries: { limit: 3, delay: "10 seconds" as const, backoff: "exponential" as const } };

export class EncodeFilmWorkflow extends WorkflowEntrypoint<Env, EncodeParams> {
  async run(event: WorkflowEvent<EncodeParams>, step: WorkflowStep) {
    const { filmId, sourceKey } = event.payload;

    // step 6: get-keys. One key for video, one for audio. Never logged.
    await step.do("get-keys", retry, async () => {
      const existing = await this.env.KEYS.get(`keys:${filmId}`);
      if (existing) return "reused";
      // Phase A: cenc, because Chrome's ClearKey stalls on cbcs at the first segment boundary (verified 2026-09-20).
      // Phase B: switch to cbcs when the DRM vendor issues real Widevine/FairPlay/PlayReady licenses.
      const scheme = this.env.KEY_SCHEME || "cenc";
      // Three keys: VIDEO for rungs up to 1080p, VIDEO_UHD for 2160p, AUDIO. A separate UHD key is what lets
      // the license server withhold 4K from devices without HDCP / hardware DRM (proposal step 8 policy).
      const keys = { VIDEO: { kid: hex(16), key: hex(16) }, VIDEO_UHD: { kid: hex(16), key: hex(16) }, AUDIO: { kid: hex(16), key: hex(16) }, scheme, iv: hex(16) };
      await this.env.KEYS.put(`keys:${filmId}`, JSON.stringify(keys));
      await this.env.DB.batch((["VIDEO", "VIDEO_UHD", "AUDIO"] as const).map((label) =>
        this.env.DB.prepare("INSERT OR REPLACE INTO film_keys (film_id,label,key_id,scheme) VALUES (?,?,?,?)").bind(filmId, label, keys[label].kid, scheme)));
      return "created";
    });

    // step 5 hand-off. Phase A: mark queued; the local runner picks it up via GET /jobs/next.
    // Phase B: this step calls the Cloudflare Container's POST /encode instead.
    await step.do("queue-for-encoder", retry, async () => {
      await this.env.DB.prepare("UPDATE films SET status='queued', workflow_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN ('uploaded','queued','failed')")
        .bind(event.instanceId, filmId).run();
    });

    // encode: wait up to 24 h for the runner to POST /jobs/{filmId}/done, which sends this event.
    const done = await step.waitForEvent<EncodeDone>("encode", { type: "encode-done", timeout: "24 hours" });
    if (!done.payload.ok) {
      await this.env.DB.prepare("UPDATE films SET status='failed', error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
        .bind(done.payload.error ?? "encoder reported failure", filmId).run();
      throw new Error(`encode failed: ${done.payload.error}`);
    }

    // verify: manifests exist in ztor-streams.
    await step.do("verify", retry, async () => {
      const film = await this.env.DB.prepare("SELECT version, protections FROM films WHERE id=?").bind(filmId).first<{ version: number; protections?: string }>();
      const prefix = `films/${filmId}/v${film?.version ?? 1}`;
      const wantUrl = String(film?.protections ?? "drm").split(",").includes("url");
      const [mpd, m3u8, urlMpd] = await Promise.all([
        this.env.STREAMS.head(`${prefix}/manifest.mpd`),
        this.env.STREAMS.head(`${prefix}/master.m3u8`),
        wantUrl ? this.env.STREAMS.head(`${prefix}/url/manifest.mpd`) : Promise.resolve(null),
      ]);
      if (!mpd || !m3u8) throw new Error("manifests missing after encode");
      if (wantUrl && !urlMpd) throw new Error("protected-URL manifests missing after encode");
      return { mpd: mpd.size, m3u8: m3u8.size, urlMpd: urlMpd?.size ?? null };
    });

    // publish
    await step.do("publish", retry, async () => {
      await this.env.DB.prepare("UPDATE films SET status='ready', error=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(filmId).run();
    });
    return { filmId, status: "ready", sourceKey };
  }
}
