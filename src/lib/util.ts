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
