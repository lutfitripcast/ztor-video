// Watch party: Cloudflare Realtime SFU (WebRTC) and Realtime TURN, called from the Worker only.
// The browser never sees the app secret. The SFU forwards the host's camera / mic / screen tracks to viewers;
// the film itself never goes through here (it is served from R2 as protected-URL HLS/DASH).
// API: https://developers.cloudflare.com/realtime/sfu/api/   base https://rtc.live.cloudflare.com/v1
import type { Env } from "./env";

const BASE = "https://rtc.live.cloudflare.com/v1";

export const sfuConfigured = (env: Env) => !!(env.REALTIME_APP_ID && env.REALTIME_APP_SECRET);

export interface SessionDescription { type: "offer" | "answer"; sdp: string }
export interface SfuTrackResult { mid?: string; trackName?: string; sessionId?: string; errorCode?: string; errorDescription?: string; error?: { errorCode: string; errorDescription: string } }
export interface TracksResponse { requiresImmediateRenegotiation?: boolean; sessionDescription?: SessionDescription; tracks?: SfuTrackResult[]; errorCode?: string; errorDescription?: string }

async function call<T = any>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}/apps/${env.REALTIME_APP_ID}${path}`, {
    method, headers: { authorization: `Bearer ${env.REALTIME_APP_SECRET}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j: any; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!r.ok) throw new Error(`SFU ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  if (j?.errorCode) throw new Error(`SFU ${method} ${path} -> ${j.errorCode}: ${j.errorDescription ?? ""}`);
  return j as T;
}

export const newSession = (env: Env) => call<{ sessionId: string }>(env, "POST", "/sessions/new");
export const tracksNew = (env: Env, sessionId: string, body: { sessionDescription?: SessionDescription; tracks: Record<string, unknown>[] }) =>
  call<TracksResponse>(env, "POST", `/sessions/${sessionId}/tracks/new`, body);
export const tracksUpdate = (env: Env, sessionId: string, body: { tracks: Record<string, unknown>[] }) =>
  call<TracksResponse>(env, "PUT", `/sessions/${sessionId}/tracks/update`, body);
export const renegotiate = (env: Env, sessionId: string, answer: SessionDescription) =>
  call<{ errorCode?: string }>(env, "PUT", `/sessions/${sessionId}/renegotiate`, { sessionDescription: answer });
export const closeTracks = (env: Env, sessionId: string, body: { tracks: { mid: string }[]; sessionDescription?: SessionDescription; force?: boolean }) =>
  call<TracksResponse>(env, "PUT", `/sessions/${sessionId}/tracks/close`, body);
export const getSession = (env: Env, sessionId: string) => call(env, "GET", `/sessions/${sessionId}`);

/** ICE servers for the browser. With a TURN key: short-lived TURN credentials (relay for strict NATs). Without: STUN only. */
export async function iceServers(env: Env, ttlS = 4 * 3600): Promise<unknown[]> {
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    try {
      const r = await fetch(`${BASE}/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: "POST", headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ ttl: ttlS }),
      });
      if (r.ok) { const j = await r.json<any>(); if (j?.iceServers) return Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers]; }
    } catch {}
  }
  return [{ urls: "stun:stun.cloudflare.com:3478" }];
}
