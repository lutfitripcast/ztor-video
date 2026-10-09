// Watch party room: one Durable Object per party (SQLite-backed, Free plan).
// Holds what LiveKit's "room" held: roster, chat, pinned comment, moderation, the host's playback clock, and where
// the host's WebRTC tracks live (SFU session id + track names) so late joiners can pull them.
// Viewers connect over WebSocket (Hibernation API: idle sockets cost nothing). Chat is archived to D1 in batches.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../lib/env";

export type Role = "host" | "viewer";
export interface Clock { state: "playing" | "paused"; position: number; rate: number; at: number; rtt?: number }   // at = server ms when set; rtt = host's round trip to the SFU in ms (viewers align the film with the host's voice)
export interface HostTrack { sessionId: string; trackName: string; kind: "audio" | "video" }   // sessionId = the host's SFU session that publishes it
export interface HostTracks { tracks: HostTrack[] }
export interface ChatMsg { seq: number; userId: string; name: string; role: Role; text: string; at: number }
export interface PartyMeta { partyId: string; filmId: string; hostId: string; title: string; status: "live" | "ended"; createdAt: number }
interface Attachment { userId: string; name: string; role: Role; deviceId: string; connectedAt: number }
interface Action { actor: string; action: string; target?: string; detail?: string; at: number }

const MAX_TEXT = 500;            // chars per chat message
const RECENT = 50;               // messages replayed to a late joiner
const CHAT_GAP_MS = 1500;        // viewer floor: one message per 1.5 s (slow mode raises it)
const TICK_S = 3;                // alarm cadence: flush chat + actions to D1, roster broadcast
const MAX_SLOW_S = 300;

const send = (ws: WebSocket, m: unknown) => { try { ws.send(JSON.stringify(m)); } catch {} };

export class PartyRoom extends DurableObject<Env> {
  meta: PartyMeta | null = null;
  clock: Clock = { state: "paused", position: 0, rate: 1, at: Date.now() };
  clockSavedAt = 0;
  pinned: ChatMsg | null = null;
  hostTracks: HostTracks | null = null;
  banned = new Set<string>();
  muted = new Set<string>();
  slowModeS = 0;
  seq = 0;
  recent: ChatMsg[] = [];
  // in-memory only (lost on hibernation, which is fine): rate limiting and roster change detection
  lastChatAt = new Map<string, number>();
  lastRoster = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const s = await ctx.storage.get<any>(["meta", "clock", "pinned", "hostTracks", "banned", "muted", "slowModeS", "seq", "recent"]) as Map<string, any>;
      this.meta = s.get("meta") ?? null;
      this.clock = s.get("clock") ?? this.clock;
      this.pinned = s.get("pinned") ?? null;
      this.hostTracks = s.get("hostTracks") ?? null;
      this.banned = new Set(s.get("banned") ?? []);
      this.muted = new Set(s.get("muted") ?? []);
      this.slowModeS = s.get("slowModeS") ?? 0;
      this.seq = s.get("seq") ?? 0;
      this.recent = s.get("recent") ?? [];
    });
    // keepalive answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---- Worker-facing internal API (never reachable from the internet: the Worker owns the routes) ----------------
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/internal/init" && req.method === "POST") {
      const m = await req.json<PartyMeta>();
      if (!this.meta) { this.meta = { ...m, status: "live", createdAt: Date.now() }; await this.ctx.storage.put("meta", this.meta); }
      return Response.json({ ok: true, meta: this.meta });
    }
    if (p === "/internal/state") return Response.json(this.state());
    if (p === "/internal/tracks" && req.method === "POST") {
      // host's SFU session + track names; null when the host stops publishing everything
      const body = await req.json<HostTracks | null>();
      const tracks = (body && Array.isArray(body.tracks) ? body.tracks : []).filter((t) => t && typeof t.sessionId === "string" && typeof t.trackName === "string").slice(0, 8);
      this.hostTracks = tracks.length ? { tracks } : null;
      await this.ctx.storage.put("hostTracks", this.hostTracks);
      this.broadcast({ t: "tracks", hostTracks: this.hostTracks });
      return Response.json({ ok: true, hostTracks: this.hostTracks });
    }
    if (p === "/internal/end" && req.method === "POST") { await this.end(url.searchParams.get("by") ?? "system"); return Response.json({ ok: true }); }
    if (p === "/internal/ws") {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
      const userId = req.headers.get("x-party-user") ?? "", role = (req.headers.get("x-party-role") as Role) || "viewer", deviceId = req.headers.get("x-party-device") ?? "";
      const name = decodeURIComponent(req.headers.get("x-party-name") ?? "") || userId;
      if (!this.meta) return new Response("party not initialised", { status: 409 });
      if (this.meta.status === "ended") return new Response("party ended", { status: 410 });
      if (this.banned.has(userId)) return new Response("removed from this party", { status: 403 });
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server, [`u:${userId}`, `r:${role}`]);
      server.serializeAttachment({ userId, name, role, deviceId, connectedAt: Date.now() } satisfies Attachment);
      send(server, { t: "hello", you: { userId, name, role }, party: this.meta, clock: this.clock, pinned: this.pinned, hostTracks: this.hostTracks,
        slowModeS: this.slowModeS, muted: this.muted.has(userId), recent: this.recent, ...this.roster(), serverTime: Date.now() });
      await this.ensureAlarm();
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  state() {
    return { meta: this.meta, clock: this.clock, pinned: this.pinned, hostTracks: this.hostTracks, banned: [...this.banned], muted: [...this.muted], slowModeS: this.slowModeS, ...this.roster() };
  }

  roster() {
    const socks = this.ctx.getWebSockets();
    const users = new Set<string>(); let hostOnline = false;
    for (const ws of socks) { const a = ws.deserializeAttachment() as Attachment | null; if (a) { users.add(a.userId); if (a.role === "host") hostOnline = true; } }
    return { viewers: users.size, connections: socks.length, hostOnline };
  }

  broadcast(m: unknown, except?: WebSocket) {
    const s = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) { try { ws.send(s); } catch {} }
  }

  // ---- WebSocket protocol -------------------------------------------------------------------------------------
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 4000) return;
    let m: any; try { m = JSON.parse(raw); } catch { return; }
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || !this.meta) return;
    const host = a.role === "host";
    const forbid = () => send(ws, { t: "error", code: "forbidden", detail: `${m.t}: host only` });
    switch (m.t) {
      case "time": return send(ws, { t: "time", c: m.c, s: Date.now() });   // NTP-style offset for the sync clock

      case "chat": {
        const text = String(m.text ?? "").trim().slice(0, MAX_TEXT);
        if (!text) return;
        if (this.muted.has(a.userId)) return send(ws, { t: "error", code: "muted", detail: "you are muted in this party" });
        const gap = host ? 0 : Math.max(CHAT_GAP_MS, this.slowModeS * 1000);
        const last = this.lastChatAt.get(a.userId) ?? 0, now = Date.now();
        if (gap && now - last < gap) return send(ws, { t: "error", code: "rate", retryInMs: gap - (now - last), detail: this.slowModeS ? `slow mode: one message per ${this.slowModeS} s` : "too fast" });
        this.lastChatAt.set(a.userId, now);
        const msg: ChatMsg = { seq: ++this.seq, userId: a.userId, name: a.name, role: a.role, text, at: now };
        this.recent.push(msg); if (this.recent.length > RECENT) this.recent.splice(0, this.recent.length - RECENT);
        await this.ctx.storage.put({ seq: this.seq, recent: this.recent, [`c:${String(msg.seq).padStart(9, "0")}`]: msg });
        this.broadcast({ t: "chat", msg });
        return this.ensureAlarm();
      }

      case "clock": {
        if (!host) return forbid();
        const state = m.state === "playing" ? "playing" : "paused";
        const position = Math.max(0, Number(m.position) || 0), rate = Math.min(2, Math.max(0.5, Number(m.rate) || 1));
        // The host stamps the clock in room time itself (its NTP-style offset), so viewers are not behind by the host's
        // uplink latency. Accept the stamp when it is close to our own clock; otherwise fall back to arrival time.
        const now = Date.now(), at = typeof m.at === "number" && Math.abs(m.at - now) < 3000 ? m.at : now;
        const prev = this.clock, expected = prev.state === "playing" ? prev.position + (at - prev.at) / 1000 * prev.rate : prev.position;
        const rtt = Math.min(2000, Math.max(0, Number(m.rtt) || 0));
        this.clock = { state, position, rate, at, rtt };
        // The host now reports every second; persist only state changes, seeks and a 5 s heartbeat (not every tick).
        if (state !== prev.state || rate !== prev.rate || Math.abs(position - expected) > 1 || now - this.clockSavedAt > 5000) { this.clockSavedAt = now; await this.ctx.storage.put("clock", this.clock); }
        return this.broadcast({ t: "clock", clock: this.clock }, ws);
      }

      case "pin": {
        if (!host) return forbid();
        const msg = this.recent.find((x) => x.seq === Number(m.seq)) ?? (m.msg && typeof m.msg.text === "string" ? { seq: Number(m.msg.seq) || 0, userId: String(m.msg.userId ?? ""), name: String(m.msg.name ?? m.msg.userId ?? ""), role: "viewer" as Role, text: String(m.msg.text).slice(0, MAX_TEXT), at: Date.now() } : null);
        if (!msg) return send(ws, { t: "error", code: "not_found", detail: "message not in the recent window" });
        this.pinned = msg; await this.ctx.storage.put("pinned", msg);
        this.broadcast({ t: "pin", pinned: msg });
        return this.action(a.userId, "pin", msg.userId, `#${msg.seq} ${msg.text.slice(0, 120)}`);
      }
      case "unpin": {
        if (!host) return forbid();
        this.pinned = null; await this.ctx.storage.put("pinned", null);
        this.broadcast({ t: "pin", pinned: null });
        return this.action(a.userId, "unpin");
      }

      case "kick": {
        if (!host) return forbid();
        const target = String(m.userId ?? ""); if (!target || target === this.meta.hostId) return;
        this.banned.add(target); await this.ctx.storage.put("banned", [...this.banned]);
        const tname = (this.ctx.getWebSockets(`u:${target}`)[0]?.deserializeAttachment() as Attachment | null)?.name ?? this.recent.find((x) => x.userId === target)?.name ?? target;
        for (const s of this.ctx.getWebSockets(`u:${target}`)) { send(s, { t: "kicked" }); try { s.close(4001, "removed by host"); } catch {} }
        this.broadcast({ t: "system", text: `${tname} was removed by the host` });
        return this.action(a.userId, "kick", target);
      }
      case "mute": case "unmute": {
        if (!host) return forbid();
        const target = String(m.userId ?? ""); if (!target) return;
        if (m.t === "mute") this.muted.add(target); else this.muted.delete(target);
        await this.ctx.storage.put("muted", [...this.muted]);
        for (const s of this.ctx.getWebSockets(`u:${target}`)) send(s, { t: "muted", muted: m.t === "mute" });
        return this.action(a.userId, m.t, target);
      }
      case "slow": {
        if (!host) return forbid();
        this.slowModeS = Math.min(MAX_SLOW_S, Math.max(0, Math.floor(Number(m.seconds) || 0)));
        await this.ctx.storage.put("slowModeS", this.slowModeS);
        this.broadcast({ t: "slow", slowModeS: this.slowModeS });
        return this.action(a.userId, "slow", undefined, String(this.slowModeS));
      }
      case "end": { if (!host) return forbid(); return this.end(a.userId); }
      default: return send(ws, { t: "error", code: "unknown", detail: `unknown message type ${m.t}` });
    }
  }

  async webSocketClose(ws: WebSocket) { try { ws.close(); } catch {} }
  async webSocketError(ws: WebSocket) { try { ws.close(1011, "error"); } catch {} }

  // ---- housekeeping -------------------------------------------------------------------------------------------
  async action(actor: string, action: string, target?: string, detail?: string) {
    await this.ctx.storage.put(`a:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, { actor, action, target, detail, at: Date.now() } satisfies Action);
    await this.ensureAlarm();
  }

  async ensureAlarm() { if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + TICK_S * 1000); }

  async alarm() {
    await this.flush();
    const r = this.roster(); const key = `${r.viewers}/${r.connections}/${r.hostOnline}`;
    // host gone (page closed or reloaded) while tracks are still announced: retract them so viewers drop the dead sessions
    if (!r.hostOnline && this.hostTracks) { this.hostTracks = null; await this.ctx.storage.put("hostTracks", null); this.broadcast({ t: "tracks", hostTracks: null }); }
    if (key !== this.lastRoster) { this.lastRoster = key; this.broadcast({ t: "roster", ...r }); }
    if (r.connections > 0) await this.ctx.storage.setAlarm(Date.now() + TICK_S * 1000);
  }

  /** Chat and actions go to D1 in one batch per tick instead of one write per message. */
  async flush() {
    if (!this.meta) return;
    const stmts: D1PreparedStatement[] = []; const keys: string[] = [];
    const chats = await this.ctx.storage.list<ChatMsg>({ prefix: "c:", limit: 100 });
    for (const [k, c] of chats) { keys.push(k); stmts.push(this.env.DB.prepare("INSERT OR IGNORE INTO party_messages (party_id,seq,user_id,text,sent_at) VALUES (?,?,?,?,?)").bind(this.meta.partyId, c.seq, c.userId, c.text, new Date(c.at).toISOString())); }
    const acts = await this.ctx.storage.list<Action>({ prefix: "a:", limit: 100 });
    for (const [k, x] of acts) { keys.push(k); stmts.push(this.env.DB.prepare("INSERT INTO party_actions (party_id,actor_id,action,target_id,detail,at) VALUES (?,?,?,?,?,?)").bind(this.meta.partyId, x.actor, x.action, x.target ?? null, x.detail ?? null, new Date(x.at).toISOString())); }
    if (!stmts.length) return;
    try { await this.env.DB.batch(stmts); await this.ctx.storage.delete(keys); }
    catch (e) { console.log("party flush failed, will retry", String(e)); }
  }

  async end(by: string) {
    if (!this.meta || this.meta.status === "ended") return;
    this.meta = { ...this.meta, status: "ended" }; this.hostTracks = null;
    await this.ctx.storage.put({ meta: this.meta, hostTracks: null });
    await this.action(by, "end");
    this.broadcast({ t: "ended" });
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(4000, "party ended"); } catch {} }
    await this.flush();
    try { await this.env.DB.prepare("UPDATE parties SET status='ended', ended_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(this.meta.partyId).run(); } catch {}
  }
}
