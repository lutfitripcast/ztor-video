// Small helpers shared by the route handlers.
import type { Env } from "./env";

export const MIME: Record<string, string> = {
  m4s: "video/iso.segment", mp4: "video/mp4", m3u8: "application/vnd.apple.mpegurl",
  vtt: "text/vtt", json: "application/json",
};
export const ext = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
export const isManifest = (p: string) => /\.(m3u8|mpd)$/i.test(p);

/** Encoder runner and operator routes share one bearer token. */
export const runnerOk = (req: Request, env: Env) => req.headers.get("authorization") === `Bearer ${env.RUNNER_TOKEN}`;
/** Creator auth stub: any X-Creator-Id header. Real creator login is not built. */
export const creatorId = (req: Request) => req.headers.get("x-creator-id");

/** Subtitle tracks of a film: WebVTT sidecar files at films/<id>/v<n>/subs/<lang>.vtt, side-loaded by the player, so every
 *  viewer picks their own language (2026-10-15). Public objects: the media route serves them without a pass. */
const SUB_LABELS: Record<string, string> = { "en": "English", "en-us": "English", "zh": "中文", "zh-hk": "中文（繁體）", "zh-tw": "中文（繁體）", "zh-cn": "中文（简体）", "ms": "Bahasa Melayu", "id": "Bahasa Indonesia", "ja": "日本語", "ko": "한국어", "th": "ไทย" };
export async function listSubtitles(env: Env, origin: string, filmId: string, version: number) {
  const prefix = `films/${filmId}/v${version}/subs/`;
  const l = await env.STREAMS.list({ prefix, limit: 50 });
  return l.objects.filter((o) => o.key.endsWith(".vtt")).map((o) => { const lang = o.key.slice(prefix.length, -4).toLowerCase(); return { lang, label: SUB_LABELS[lang] ?? lang, url: `${origin}/media/${filmId}/v${version}/subs/${lang}.vtt` }; });
}

/** Audio languages of a film (2026-10-16): one AAC track per language, packaged as one HLS audio playlist each. Read from the
 *  packaged master playlist (EXT-X-MEDIA TYPE=AUDIO lines), so nothing is stored: the protected-URL master if it exists, else the
 *  DRM one; both carry the same tracks. Films encoded before 2026-10-16 have one track with no language ("und" = Original). */
const AUDIO_LABELS: Record<string, string> = { "und": "Original", "en": "English", "eng": "English", "zh": "中文", "zho": "中文", "chi": "中文", "yue": "粵語", "cmn": "普通話", "zh-hk": "粵語", "zh-cn": "普通話", "zh-tw": "國語",
  "ja": "日本語", "jpn": "日本語", "ko": "한국어", "kor": "한국어", "th": "ไทย", "tha": "ไทย", "ms": "Bahasa Melayu", "msa": "Bahasa Melayu", "may": "Bahasa Melayu", "id": "Bahasa Indonesia", "ind": "Bahasa Indonesia",
  "fr": "Français", "fra": "Français", "fre": "Français", "de": "Deutsch", "deu": "Deutsch", "ger": "Deutsch", "es": "Español", "spa": "Español", "ta": "தமிழ்", "tam": "தமிழ்", "hi": "हिन्दी", "hin": "हिन्दी" };
export interface AudioTrack { lang: string; label: string; default: boolean }
export async function listAudio(env: Env, filmId: string, version: number): Promise<AudioTrack[]> {
  const prefix = `films/${filmId}/v${version}`;
  const obj = (await env.STREAMS.get(`${prefix}/url/master.m3u8`)) ?? (await env.STREAMS.get(`${prefix}/master.m3u8`));
  if (!obj) return [];
  const out: AudioTrack[] = [];
  for (const line of (await obj.text()).split("\n")) {
    if (!line.startsWith("#EXT-X-MEDIA:") || !/TYPE=AUDIO/.test(line)) continue;
    const lang = (/LANGUAGE="([^"]+)"/.exec(line)?.[1] ?? "und").toLowerCase();
    if (out.some((a) => a.lang === lang)) continue;
    out.push({ lang, label: AUDIO_LABELS[lang] ?? lang, default: /DEFAULT=YES/.test(line) });
  }
  if (out.length && !out.some((a) => a.default)) out[0].default = true;
  return out;
}

/** An unexpired row in `rentals` for this viewer and film. */
export async function hasRental(env: Env, userId: string, filmId: string) {
  const r = await env.DB.prepare("SELECT 1 FROM rentals WHERE user_id=? AND film_id=? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(userId, filmId).first();
  return !!r;
}

/** License rate limit: LICENSE_RATE_LIMIT per viewer per minute; "0" disables it. Rows are still logged. */
export async function licenseLimited(env: Env, userId: string): Promise<boolean> {
  const cap = Number(env.LICENSE_RATE_LIMIT ?? "10");
  if (!cap) return false;
  try { if (!(await env.LICENSE_RL.limit({ key: `lic:${userId}` })).success) return true; } catch {}
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM licenses WHERE user_id=? AND issued_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds')").bind(userId).first<{ n: number }>();
  return (recent?.n ?? 0) >= cap;
}
