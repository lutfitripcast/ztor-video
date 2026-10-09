// Small helpers shared by the route handlers.
import type { Env } from "./env";

export const MIME: Record<string, string> = {
  m4s: "video/iso.segment", mp4: "video/mp4", m3u8: "application/vnd.apple.mpegurl", mpd: "application/dash+xml",
  vtt: "text/vtt", json: "application/json",
};
export const ext = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
export const isManifest = (p: string) => /\.(m3u8|mpd)$/i.test(p);

/** Encoder runner and operator routes share one bearer token. */
export const runnerOk = (req: Request, env: Env) => req.headers.get("authorization") === `Bearer ${env.RUNNER_TOKEN}`;
/** Creator auth stub: any X-Creator-Id header. Real creator login is not built. */
export const creatorId = (req: Request) => req.headers.get("x-creator-id");

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
