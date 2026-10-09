// Operator routes (runner token): rentals, license meters, re-encode, delete a film.
import type { Env } from "../lib/env";
import { json, err } from "../lib/env";
import { runnerOk } from "../lib/util";

export async function handleAdmin(req: Request, env: Env, url: URL, seg: string[]): Promise<Response> {
  if (!runnerOk(req, env)) return err("runner token required", 401);
  if (req.method === "POST" && seg[1] === "rentals") {
    const b = await req.json<{ userId: string; filmId: string; hours?: number }>();
    const exp = new Date(Date.now() + (b.hours ?? 48) * 3600e3).toISOString();
    await env.DB.prepare("INSERT OR REPLACE INTO rentals (user_id,film_id,expires_at) VALUES (?,?,?)").bind(b.userId, b.filmId, exp).run();
    return json({ ok: true, expires_at: exp });
  }
  if (req.method === "GET" && seg[1] === "licenses") {
    const r = await env.DB.prepare("SELECT film_id, drm, COUNT(*) AS licenses, COUNT(DISTINCT user_id||device_id) AS sessions FROM licenses GROUP BY film_id, drm").all();
    return json(r.results);
  }
  if (req.method === "POST" && seg[1] === "requeue" && seg[2]) {
    const prot = url.searchParams.get("protections");   // "drm" | "drm,url": which versions the re-encode should produce
    if (prot && /^(drm|url)(,(drm|url))?$/.test(prot)) await env.DB.prepare("UPDATE films SET protections=? WHERE id=?").bind(prot, seg[2]).run();
    const scheme = url.searchParams.get("scheme");
    if (scheme && (scheme === "cenc" || scheme === "cbcs")) {
      const k = JSON.parse((await env.KEYS.get(`keys:${seg[2]}`)) ?? "null");
      if (k) { k.scheme = scheme; await env.KEYS.put(`keys:${seg[2]}`, JSON.stringify(k)); }
      await env.DB.prepare("UPDATE film_keys SET scheme=? WHERE film_id=?").bind(scheme, seg[2]).run();
    }
    await env.DB.prepare("UPDATE films SET status='uploaded', error=NULL, version=version+1 WHERE id=?").bind(seg[2]).run();
    const film = await env.DB.prepare("SELECT source_key, version FROM films WHERE id=?").bind(seg[2]).first<any>();
    let workflow = "started";
    try { await env.ENCODE_FILM.create({ id: `${seg[2]}-${Date.now()}`, params: { filmId: seg[2], sourceKey: film.source_key } }); } catch (e: any) { workflow = e.message; }
    return json({ ok: true, workflow, version: film.version });
  }
  // cleanup: delete a film's master, every stream version and its key material; keep the D1 row as 'deleted'
  if (req.method === "DELETE" && seg[1] === "films" && seg[2]) {
    const film = await env.DB.prepare("SELECT source_key FROM films WHERE id=?").bind(seg[2]).first<any>();
    if (!film) return err("film not found", 404);
    let deleted = 0;
    for (const [bucket, prefix] of [[env.STREAMS, `films/${seg[2]}/`], [env.MASTERS, `masters/${seg[2]}/`]] as const) {
      let cursor: string | undefined;
      do {
        const l = await bucket.list({ prefix, cursor, limit: 1000 });
        if (l.objects.length) { await bucket.delete(l.objects.map((o) => o.key)); deleted += l.objects.length; }
        cursor = l.truncated ? l.cursor : undefined;
      } while (cursor);
    }
    await env.KEYS.delete(`keys:${seg[2]}`);
    await env.DB.prepare("UPDATE films SET status='deleted', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(seg[2]).run();
    return json({ ok: true, filmId: seg[2], objectsDeleted: deleted });
  }
  return err("unknown admin route", 404);
}
