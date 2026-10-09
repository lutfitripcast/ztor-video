// Encoder side (proposal step 5): the runner (local poll mode today, Cloudflare Containers later) takes the next queued film,
// uploads the packaged output and reports back. Every call needs the runner token.
import type { Env } from "../lib/env";
import { json, err } from "../lib/env";
import { MIME, ext, runnerOk } from "../lib/util";
import { presign } from "../lib/s3";

export async function handleRunner(req: Request, env: Env, url: URL, seg: string[]): Promise<Response> {
  if (!runnerOk(req, env)) return err("runner token required", 401);
  if (req.method === "GET" && seg[1] === "next") {
    const film = await env.DB.prepare("SELECT * FROM films WHERE status='queued' ORDER BY created_at LIMIT 1").first<any>();
    if (!film) return new Response(null, { status: 204 });
    await env.DB.prepare("UPDATE films SET status='encoding', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(film.id).run();
    const keys = JSON.parse((await env.KEYS.get(`keys:${film.id}`)) ?? "null");
    if (!keys) return err("keys missing for film", 500);
    const sourceUrl = await presign(env, "GET", env.MASTERS_BUCKET, film.source_key, {}, 6 * 3600);
    return json({ filmId: film.id, version: film.version, protections: film.protections ?? "drm", sourceUrl, keys, uploadEndpoint: `${url.origin}/jobs/${film.id}/output/v${film.version}/`, doneEndpoint: `${url.origin}/jobs/${film.id}/done` });
  }
  if (req.method === "PUT" && seg[2] === "output" && seg.length > 3) {
    const filmId = seg[1];
    const rel = seg.slice(3).join("/");
    if (rel.includes("..")) return err("bad path", 400);
    await env.STREAMS.put(`films/${filmId}/${rel}`, req.body, { httpMetadata: { contentType: MIME[ext(rel)] ?? "application/octet-stream" } });
    return json({ ok: true, key: `films/${filmId}/${rel}` });
  }
  if (req.method === "POST" && seg[2] === "done") {
    const filmId = seg[1];
    const body = await req.json<{ ok: boolean; error?: string; runner?: string; steps?: { step: string; wall_s: number; cpu_s?: number; bytes?: number; detail?: string }[] }>();
    if (body.steps?.length) {
      await env.DB.batch(body.steps.map((s) =>
        env.DB.prepare("INSERT INTO encode_runs (film_id,runner,step,wall_s,cpu_s,bytes,detail) VALUES (?,?,?,?,?,?,?)")
          .bind(filmId, body.runner ?? "local-mac", s.step, s.wall_s, s.cpu_s ?? null, s.bytes ?? null, s.detail ?? null)));
    }
    await env.DB.prepare("UPDATE films SET status=?, error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
      .bind(body.ok ? "packaged" : "failed", body.ok ? null : (body.error ?? "runner failure"), filmId).run();
    const film = await env.DB.prepare("SELECT workflow_id FROM films WHERE id=?").bind(filmId).first<any>();
    let signalled = false;
    if (film?.workflow_id) {
      try { await (await env.ENCODE_FILM.get(film.workflow_id)).sendEvent({ type: "encode-done", payload: { ok: body.ok, error: body.error, runner: body.runner } }); signalled = true; }
      catch (e: any) { return json({ ok: true, signalled: false, warning: e.message }); }
    }
    return json({ ok: true, signalled });
  }
  return err("unknown jobs route", 404);
}
