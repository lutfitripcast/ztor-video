// Film status for creators and operators.
import type { Env } from "../lib/env";
import { json, err } from "../lib/env";

export async function handleFilms(req: Request, env: Env, url: URL, seg: string[]): Promise<Response> {
  if (req.method === "GET" && seg.length === 1) {
    const r = await env.DB.prepare("SELECT id,title,status,creator_id,created_at,updated_at,error FROM films ORDER BY created_at DESC LIMIT 50").all();
    return json(r.results);
  }
  if (req.method === "GET" && seg[0] === "films" && seg.length === 2) {
    const film = await env.DB.prepare("SELECT id,title,status,creator_id,source_key,workflow_id,version,protections,created_at,updated_at,error FROM films WHERE id=?").bind(seg[1]).first<any>();
    if (!film) return err("film not found", 404);
    const keys = await env.DB.prepare("SELECT label,key_id,scheme FROM film_keys WHERE film_id=?").bind(seg[1]).all();
    const runs = await env.DB.prepare("SELECT runner,step,wall_s,cpu_s,bytes,detail,recorded_at FROM encode_runs WHERE film_id=? ORDER BY id").bind(seg[1]).all();
    let workflow: unknown = null;
    if (film.workflow_id) { try { workflow = await (await env.ENCODE_FILM.get(film.workflow_id)).status(); } catch {} }
    return json({ ...film, keys: keys.results, encode_runs: runs.results, workflow });
  }
  return err("not found", 404);
}
