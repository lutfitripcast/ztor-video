// JSON API for the /app page (login-based). Everything here reads the user from the session cookie.
//   GET  /api/films                 ready films with this user's rental state
//   POST /api/rent/{filmId}         rent for 48 h (free while there is no payment step)
//   GET  /api/parties               live parties with counts
//   GET  /api/admin/users           admin: list users
//   PUT  /api/admin/users/{id}/role admin: {role}
import type { Env } from "../lib/env";
import { json, err } from "../lib/env";
import { currentUser, publicUser, type Role } from "../lib/auth";

const ROLES: Role[] = ["admin", "host", "user"];

export async function handleApp(req: Request, env: Env, url: URL, seg: string[]): Promise<Response> {
  const me = await currentUser(req, env);
  if (!me) return err("sign in first", 401);
  const op = seg[1];

  if (req.method === "GET" && op === "films") {
    const films = await env.DB.prepare("SELECT f.id,f.title,f.version,f.protections,f.updated_at,r.expires_at AS rental_expires FROM films f LEFT JOIN rentals r ON r.film_id=f.id AND r.user_id=? AND r.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE f.status='ready' ORDER BY f.updated_at DESC").bind(me.id).all<any>();
    return json(films.results.map((f) => ({ id: f.id, title: f.title, version: f.version, protections: String(f.protections ?? "drm").split(","), rented: !!f.rental_expires, rentalExpires: f.rental_expires ?? null })));
  }
  if (req.method === "POST" && op === "rent" && seg[2]) {
    const film = await env.DB.prepare("SELECT id,status FROM films WHERE id=?").bind(seg[2]).first<any>();
    if (!film || film.status !== "ready") return err("film not available", 404);
    const exp = new Date(Date.now() + 48 * 3600e3).toISOString();
    await env.DB.prepare("INSERT OR REPLACE INTO rentals (user_id,film_id,expires_at) VALUES (?,?,?)").bind(me.id, seg[2], exp).run();
    return json({ ok: true, filmId: seg[2], expiresAt: exp, price: "free (no payment step yet)" });
  }
  if (req.method === "GET" && op === "parties") {
    const rows = await env.DB.prepare("SELECT p.id,p.title,p.host_id,p.created_at,f.title AS film_title,f.id AS film_id,u.name AS host_name FROM parties p JOIN films f ON f.id=p.film_id LEFT JOIN users u ON u.id=p.host_id WHERE p.status='live' ORDER BY p.created_at DESC LIMIT 20").all<any>();
    const out = await Promise.all(rows.results.map(async (p) => {
      let s: any = {}; try { s = await (await env.PARTY.get(env.PARTY.idFromName(p.id)).fetch("https://party/internal/state")).json(); } catch {}
      const hasTicket = p.host_id === me.id || !!(await env.DB.prepare("SELECT 1 FROM party_tickets WHERE party_id=? AND user_id=?").bind(p.id, me.id).first());
      return { id: p.id, title: p.title, filmId: p.film_id, filmTitle: p.film_title, hostId: p.host_id, hostName: p.host_name ?? p.host_id, createdAt: p.created_at, viewers: s.viewers ?? 0, hostOnline: !!s.hostOnline, live: !!s.hostTracks, mine: p.host_id === me.id, hasTicket };
    }));
    return json(out);
  }
  if (op === "admin") {
    if (me.role !== "admin") return err("admin only", 403);
    if (req.method === "GET" && seg[2] === "users") {
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const rows = q
        ? await env.DB.prepare("SELECT id,email,name,role,created_at,last_login_at FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC LIMIT 200").bind(`%${q}%`, `%${q}%`).all<any>()
        : await env.DB.prepare("SELECT id,email,name,role,created_at,last_login_at FROM users ORDER BY created_at DESC LIMIT 200").all<any>();
      return json(rows.results.map(publicUser));
    }
    if (req.method === "PUT" && seg[2] === "users" && seg[3] && seg[4] === "role") {
      const b = await req.json<{ role?: Role }>().catch(() => ({} as any));
      if (!b.role || !ROLES.includes(b.role)) return err("role must be admin, host or user", 400);
      const target = await env.DB.prepare("SELECT id,role FROM users WHERE id=?").bind(seg[3]).first<any>();
      if (!target) return err("user not found", 404);
      if (target.role === "admin" && b.role !== "admin") {
        const admins = await env.DB.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").first<{ n: number }>();
        if ((admins?.n ?? 0) <= 1) return err("cannot demote the last admin", 409);
      }
      await env.DB.prepare("UPDATE users SET role=? WHERE id=?").bind(b.role, seg[3]).run();
      return json({ ok: true, id: seg[3], role: b.role });
    }
    return err("unknown admin route", 404);
  }
  return err("unknown api route", 404);
}
