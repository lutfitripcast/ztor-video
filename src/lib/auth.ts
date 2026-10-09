// Accounts, sessions and roles. Email + password, PBKDF2 in the Worker, HttpOnly cookie, sessions in D1.
//   POST /auth/register {email,name,password}   first account ever -> admin, others -> user
//   POST /auth/login    {email,password}
//   POST /auth/logout
//   GET  /auth/me
import type { Env } from "./env";
import { json, err } from "./env";

export type Role = "admin" | "host" | "user";
export interface User { id: string; email: string; name: string; role: Role; created_at: string; last_login_at: string | null }

const COOKIE = "ztor_session";
const SESSION_DAYS = 30;
const ITER = 100_000;   // Workers cap PBKDF2 at 100,000 iterations
const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rand = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function pbkdf2(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, key, 256));
}
const timingSafeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

const cookieValue = (req: Request) => req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1) ?? null;
const setCookie = (value: string, maxAgeS: number) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`;

/** The logged-in user for this request, or null. One D1 read; sessions past expiry are ignored. */
export async function currentUser(req: Request, env: Env): Promise<User | null> {
  const v = cookieValue(req); if (!v || !/^[a-f0-9]{64}$/.test(v)) return null;
  const sid = await sha256(v);
  return env.DB.prepare("SELECT u.id,u.email,u.name,u.role,u.created_at,u.last_login_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(sid).first<User>();
}
export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.created_at, lastLoginAt: u.last_login_at });

async function startSession(env: Env, req: Request, userId: string) {
  const v = rand(32); const sid = await sha256(v);
  const exp = new Date(Date.now() + SESSION_DAYS * 86400e3).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id,user_id,expires_at,user_agent) VALUES (?,?,?,?)").bind(sid, userId, exp, (req.headers.get("user-agent") ?? "").slice(0, 200)).run();
  await env.DB.prepare("UPDATE users SET last_login_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(userId).run();
  return setCookie(v, SESSION_DAYS * 86400);
}

export async function handleAuth(req: Request, env: Env, seg: string[]): Promise<Response> {
  const op = seg[1];
  if (req.method === "GET" && op === "me") {
    const u = await currentUser(req, env);
    return u ? json({ user: publicUser(u) }) : json({ user: null }, 401);
  }
  if (req.method === "POST" && op === "register") {
    const b = await req.json<{ email?: string; name?: string; password?: string }>().catch(() => ({} as any));
    const email = String(b.email ?? "").trim().toLowerCase(), name = String(b.name ?? "").trim().slice(0, 40), password = String(b.password ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("a valid email is required", 400);
    if (name.length < 2) return err("a display name of at least 2 characters is required", 400);
    if (password.length < 8) return err("password must be at least 8 characters", 400);
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email=?").bind(email).first()) return err("an account with this email already exists", 409);
    const first = !(await env.DB.prepare("SELECT 1 FROM users LIMIT 1").first());
    const role: Role = first ? "admin" : "user";
    const id = crypto.randomUUID(), salt = rand(16), hash = await pbkdf2(password, salt);
    try { await env.DB.prepare("INSERT INTO users (id,email,name,password_hash,salt,role) VALUES (?,?,?,?,?,?)").bind(id, email, name, hash, salt, role).run(); }
    catch { return err("an account with this email already exists", 409); }
    const cookie = await startSession(env, req, id);
    return json({ user: { id, email, name, role, createdAt: new Date().toISOString(), lastLoginAt: null }, firstAccount: first }, 200, { "set-cookie": cookie });
  }
  if (req.method === "POST" && op === "login") {
    const b = await req.json<{ email?: string; password?: string }>().catch(() => ({} as any));
    const email = String(b.email ?? "").trim().toLowerCase(), password = String(b.password ?? "");
    const row = await env.DB.prepare("SELECT id,email,name,role,created_at,last_login_at,password_hash,salt FROM users WHERE email=?").bind(email).first<User & { password_hash: string; salt: string }>();
    // always hash, so a missing account costs the same time as a wrong password
    const hash = await pbkdf2(password, row?.salt ?? "00".repeat(16));
    if (!row || !timingSafeEqual(hash, row.password_hash)) return err("wrong email or password", 401);
    const cookie = await startSession(env, req, row.id);
    return json({ user: publicUser(row) }, 200, { "set-cookie": cookie });
  }
  if (req.method === "POST" && op === "logout") {
    const v = cookieValue(req);
    if (v && /^[a-f0-9]{64}$/.test(v)) await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(await sha256(v)).run();
    return json({ ok: true }, 200, { "set-cookie": setCookie("", 0) });
  }
  return err("unknown auth route", 404);
}

/** Who a request acts as. A logged-in session wins; in TEST_MODE the legacy console's typed id is still honoured. */
export async function actingUser(req: Request, env: Env, bodyUserId?: string | null): Promise<{ id: string; name: string; role: Role; session: boolean } | null> {
  if (env.TEST_MODE === "true" && bodyUserId) return { id: bodyUserId, name: bodyUserId, role: "host", session: false };   // test stub: full powers, as before
  const u = await currentUser(req, env);
  return u ? { id: u.id, name: u.name, role: u.role, session: true } : null;
}
