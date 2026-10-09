// Test console helpers, only with TEST_MODE=true (and the TEST_KEY secret when set). Turn TEST_MODE off before launch.
import type { Env } from "../lib/env";
import { json, err } from "../lib/env";
import { type VendorEnv } from "../lib/drm-vendor";

export async function handleTest(req: Request, env: Env, url: URL, seg: string[]): Promise<Response> {
  if (env.TEST_MODE !== "true") return err("test routes disabled", 404);
  // optional gate: when the TEST_KEY secret is set, the console must send it as x-test-key. Unset = open (user's choice, 2026-09-21).
  if (env.TEST_KEY && req.headers.get("x-test-key") !== env.TEST_KEY) return err("test key required", 401);
  if (req.method === "GET" && seg[1] === "films") {
    const r = await env.DB.prepare("SELECT id,title,status,version,protections,updated_at FROM films WHERE status='ready' ORDER BY updated_at DESC").all();
    return json(r.results);
  }
  if (req.method === "POST" && seg[1] === "rent") {
    const b = await req.json<{ userId: string; filmId: string; hours?: number }>();
    if (!b.userId || !b.filmId) return err("userId and filmId required", 400);
    const exp = new Date(Date.now() + (b.hours ?? 48) * 3600e3).toISOString();
    await env.DB.prepare("INSERT OR REPLACE INTO rentals (user_id,film_id,expires_at) VALUES (?,?,?)").bind(b.userId, b.filmId, exp).run();
    return json({ ok: true, userId: b.userId, filmId: b.filmId, expires_at: exp });
  }
  if (req.method === "DELETE" && seg[1] === "rent") {
    const b = await req.json<{ userId: string; filmId: string }>();
    await env.DB.prepare("DELETE FROM rentals WHERE user_id=? AND film_id=?").bind(b.userId, b.filmId).run();
    return json({ ok: true, revoked: true });
  }
  if (req.method === "GET" && seg[1] === "status" && seg[2]) {
    const filmId = seg[2]; const userId = url.searchParams.get("user") ?? "";
    const rental = await env.DB.prepare("SELECT expires_at FROM rentals WHERE user_id=? AND film_id=? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(userId, filmId).first<any>();
    const lic = await env.DB.prepare("SELECT COUNT(*) n, MAX(issued_at) last FROM licenses WHERE user_id=? AND film_id=?").bind(userId, filmId).first<any>();
    const licAll = await env.DB.prepare("SELECT COUNT(*) n FROM licenses WHERE film_id=?").bind(filmId).first<any>();
    const keys = await env.DB.prepare("SELECT label,key_id,scheme FROM film_keys WHERE film_id=? ORDER BY label").bind(filmId).all();
    const runs = await env.DB.prepare("SELECT step,wall_s,cpu_s,bytes FROM encode_runs WHERE film_id=? ORDER BY id DESC LIMIT 4").bind(filmId).all();
    const filmRow = await env.DB.prepare("SELECT protections FROM films WHERE id=?").bind(filmId).first<any>();
    return json({ protections: filmRow?.protections ?? "drm", licenseRateLimit: Number(env.LICENSE_RATE_LIMIT ?? "10"), vendor: (env as VendorEnv).DRM_VENDOR ?? null, rental: rental ? { active: true, expires_at: rental.expires_at } : { active: false }, licensesThisUser: lic?.n ?? 0, lastLicense: lic?.last ?? null, licensesAllUsers: licAll?.n ?? 0, keys: keys.results, lastEncode: runs.results.reverse() });
  }
  return err("unknown test route", 404);
}
