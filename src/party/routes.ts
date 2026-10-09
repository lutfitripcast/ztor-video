// Watch party HTTP routes, all under /party. Additive to the Phase A Worker: nothing here touches existing routes.
//   POST /party                      create a party (host must hold a rental; film must have a protected-URL version)
//   GET  /party/{id}                 public info + live counts
//   POST /party/{id}/ticket          take a ticket to a live party (free until there is a payment step)
//   POST /party/{id}/join            ticket check (host exempt) -> party pass (a protected-URL film pass + party claims)
//   GET  /party/{id}/ws?t=           WebSocket to the PartyRoom Durable Object (chat, clock, pins, moderation)
//   POST /party/{id}/rtc/session     new Realtime SFU session + ICE servers            (ticket)
//   POST /party/{id}/rtc/publish     host pushes camera / mic / screen tracks           (host ticket)
//   POST /party/{id}/rtc/pull        viewer pulls the host's tracks                     (ticket, not kicked)
//   PUT  /party/{id}/rtc/renegotiate answer to an SFU-initiated offer                   (ticket)
//   PUT  /party/{id}/rtc/close       host stops tracks                                  (host ticket)
//   POST /party/{id}/end             host ends the party                                (host ticket)
//   GET  /party/{id}/messages        chat archive from D1
import type { Env } from "../lib/env";
import { json, err } from "../lib/env";
import { signJwt, verifyJwt, bearer, type PlayClaims } from "../lib/jwt";
import { sfuConfigured, newSession, tracksNew, tracksUpdate, renegotiate, closeTracks, iceServers, type SessionDescription } from "../lib/sfu";
import type { HostTracks } from "./room";
import { actingUser } from "../lib/auth";

const TRACK_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const SESSION_ID = /^[a-f0-9]{16,128}$/;
const RID = /^[a-c]$/;   // simulcast layers the host publishes: a = full, b = half, c = quarter (asciibetical: a is most desirable)
// viewers ask for the top layer; the SFU steps down on its own when the viewer's bandwidth cannot carry it
const simulcastPref = (rid = "a") => ({ preferredRid: rid, priorityOrdering: "asciibetical", ridNotAvailable: "asciibetical" });
const hasRental = async (env: Env, userId: string, filmId: string) =>
  !!(await env.DB.prepare("SELECT 1 FROM rentals WHERE user_id=? AND film_id=? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(userId, filmId).first());

const liveTracks = (list: unknown): HostTracks["tracks"] => (Array.isArray(list) ? list : [])
  .filter((x: any) => x && SESSION_ID.test(String(x.sessionId)) && TRACK_NAME.test(String(x.trackName)))
  .map((x: any) => ({ sessionId: String(x.sessionId), trackName: String(x.trackName), kind: x.kind === "audio" ? "audio" : "video" }));

const hasTicket = async (env: Env, userId: string, partyId: string) =>
  !!(await env.DB.prepare("SELECT 1 FROM party_tickets WHERE party_id=? AND user_id=?").bind(partyId, userId).first());

const room = (env: Env, partyId: string) => env.PARTY.get(env.PARTY.idFromName(partyId));
const roomState = async (env: Env, partyId: string) => (await room(env, partyId).fetch("https://party/internal/state")).json<any>();
const roomPost = (env: Env, partyId: string, path: string, body?: unknown) =>
  room(env, partyId).fetch(`https://party/internal/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export async function handleParty(req: Request, env: Env, url: URL, seg: string[]): Promise<Response> {
  // ---- create ------------------------------------------------------------------------------------------------
  if (req.method === "POST" && seg.length === 1) {
    const b = await req.json<{ hostId?: string; filmId?: string; title?: string }>().catch(() => ({} as any));
    const who = await actingUser(req, env, b.hostId);
    if (!who) return err("sign in first", 401);
    if (who.session && who.role === "user") return err("only hosts can create a party. Ask an admin to make you a host.", 403);
    b.hostId = who.id;
    if (!b.filmId) return err("filmId required", 400);
    const film = await env.DB.prepare("SELECT id,title,status,version,protections FROM films WHERE id=?").bind(b.filmId).first<any>();
    if (!film) return err("film not found", 404);
    if (film.status !== "ready") return err(`film not ready (status ${film.status})`, 409);
    if (!String(film.protections ?? "drm").split(",").includes("url")) return err("watch party needs the film's protected-URL version (no DRM in a party)", 409);
    if (!(await hasRental(env, b.hostId, b.filmId))) return json({ error: "Rent this film to host a party for it." }, 402);
    const partyId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const title = (b.title ?? `${film.title} watch party`).slice(0, 120);
    await env.DB.prepare("INSERT INTO parties (id,film_id,host_id,title) VALUES (?,?,?,?)").bind(partyId, b.filmId, b.hostId, title).run();
    await roomPost(env, partyId, "init", { partyId, filmId: b.filmId, hostId: b.hostId, title });
    return json({ partyId, title, filmId: b.filmId, hostId: b.hostId, watchUrl: `${url.origin}/watch?party=${partyId}` });
  }
  const partyId = seg[1];
  if (!partyId) return err("party id required", 400);
  const party = await env.DB.prepare("SELECT p.*, f.title AS film_title, f.version AS film_version, f.status AS film_status, u.name AS host_name FROM parties p JOIN films f ON f.id=p.film_id LEFT JOIN users u ON u.id=p.host_id WHERE p.id=?").bind(partyId).first<any>();
  if (!party) return err("party not found", 404);

  // ---- public info -------------------------------------------------------------------------------------------
  if (req.method === "GET" && seg.length === 2) {
    const s = await roomState(env, partyId);
    const who = await actingUser(req, env, url.searchParams.get("user"));
    const mine = !!who && who.id === party.host_id;
    const ticket = who ? mine || (await hasTicket(env, who.id, partyId)) : false;
    return json({ partyId, title: party.title, status: party.status, filmId: party.film_id, filmTitle: party.film_title, hostId: party.host_id, hostName: party.host_name ?? party.host_id, createdAt: party.created_at, endedAt: party.ended_at,
      viewers: s.viewers ?? 0, connections: s.connections ?? 0, hostOnline: !!s.hostOnline, hostLive: !!s.hostTracks, clock: s.clock, pinned: s.pinned, slowModeS: s.slowModeS, realtime: sfuConfigured(env),
      ticketed: true, hasTicket: ticket, mine });
  }

  // ---- ticket: entry to this party only. Free until there is a payment step. The host needs none. --------------
  if (req.method === "POST" && seg[2] === "ticket" && seg.length === 3) {
    const b = await req.json<{ userId?: string }>().catch(() => ({} as any));
    const who = await actingUser(req, env, b.userId);
    if (!who) return err("sign in first", 401);
    if (party.status === "ended") return err("this party has ended", 410);
    if (who.id === party.host_id) return json({ ok: true, partyId, host: true, note: "the host needs no ticket" });
    await env.DB.prepare("INSERT OR IGNORE INTO party_tickets (party_id,user_id,source,price_cents) VALUES (?,?,'free',0)").bind(partyId, who.id).run();
    return json({ ok: true, partyId, userId: who.id, price: "free (no payment step yet)", grants: "this party only, while it runs; not the film on its own" });
  }

  // ---- join: the party pass is a protected-URL film pass (filmId + mode=url) with party + role claims ----------
  if (req.method === "POST" && seg[2] === "join" && seg.length === 3) {
    const b = await req.json<{ userId?: string; deviceId?: string }>().catch(() => ({} as any));
    const who = await actingUser(req, env, b.userId);
    if (!who) return err("sign in first", 401);
    b.userId = who.id;
    if (party.status === "ended") return err("this party has ended", 410);
    // a ticket is the only door for viewers; a rental of the film does not substitute (user's decision, 2026-09-25)
    if (who.id !== party.host_id && !(await hasTicket(env, who.id, partyId))) return json({ error: "Get a ticket to join this party." }, 402);
    const s = await roomState(env, partyId);
    if ((s.banned as string[] | undefined)?.includes(b.userId)) return err("you were removed from this party", 403);
    const role = b.userId === party.host_id ? "host" : "viewer";
    const iat = Math.floor(Date.now() / 1000), ttl = Number(env.JWT_TTL_S);
    const token = await signJwt({ sub: b.userId, filmId: party.film_id, deviceId: b.deviceId ?? "unknown", uhd: false, mode: "url", party: partyId, role, name: who.name.slice(0, 40), iat, exp: iat + ttl }, env.JWT_SECRET);
    await env.DB.prepare("INSERT INTO party_members (party_id,user_id,role) VALUES (?,?,?) ON CONFLICT(party_id,user_id) DO UPDATE SET joins=joins+1, last_joined_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), role=excluded.role").bind(partyId, b.userId, role).run();
    const base = `${url.origin}/media/${party.film_id}/v${party.film_version}/url`;
    const wsOrigin = url.origin.replace(/^http/, "ws");
    return json({ token, expiresInS: ttl, role, partyId, title: party.title, filmId: party.film_id, filmTitle: party.film_title, hostId: party.host_id, you: { id: who.id, name: who.name },
      ws: `${wsOrigin}/party/${partyId}/ws?t=${token}`, dash: `${base}/manifest.mpd?t=${token}`, hls: `${base}/master.m3u8?t=${token}`,
      realtime: sfuConfigured(env), viewers: s.viewers ?? 0, hostLive: !!s.hostTracks,
      policy: { maxHeight: 1080, reason: "protected-URL version: no DRM, so no HDCP; capped at 1080p", sync: role === "host" ? "you drive the clock" : "your player follows the host's clock" } });
  }

  // ---- everything below needs a party ticket for THIS party ----------------------------------------------------
  const t = bearer(req, url);
  const claims = t ? await verifyJwt(t, env.JWT_SECRET) : null;
  if (!claims || claims.party !== partyId || claims.filmId !== party.film_id) return err("valid party ticket required", 401);
  const isHost = claims.role === "host" && claims.sub === party.host_id;

  if (req.method === "GET" && seg[2] === "ws" && seg.length === 3) {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return err("expected a WebSocket upgrade", 426);
    const fwd = new Request("https://party/internal/ws", req);
    fwd.headers.set("x-party-user", claims.sub); fwd.headers.set("x-party-role", isHost ? "host" : "viewer"); fwd.headers.set("x-party-device", claims.deviceId ?? ""); fwd.headers.set("x-party-name", encodeURIComponent(claims.name ?? claims.sub));
    return room(env, partyId).fetch(fwd);
  }

  if (req.method === "GET" && seg[2] === "messages") {
    const before = Number(url.searchParams.get("before") ?? 1e12);
    const r = await env.DB.prepare("SELECT seq,user_id,text,sent_at FROM party_messages WHERE party_id=? AND seq<? ORDER BY seq DESC LIMIT 100").bind(partyId, before).all();
    return json(r.results.reverse());
  }

  if (req.method === "POST" && seg[2] === "end") {
    if (!isHost) return err("host only", 403);
    await roomPost(env, partyId, `end?by=${encodeURIComponent(claims.sub)}`);
    await env.DB.prepare("UPDATE parties SET status='ended', ended_at=COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?").bind(partyId).run();
    return json({ ok: true, status: "ended" });
  }

  // ---- WebRTC signalling via the Realtime SFU (host's camera / mic / screen only; never the film) -----------------
  if (seg[2] === "rtc") {
    const op = seg[3];
    if (op === "publish" && !isHost) return err("only the host publishes tracks", 403);
    if (op === "close" && !isHost) return err("only the host closes tracks", 403);
    if (!sfuConfigured(env)) return err("Realtime SFU not configured: set REALTIME_APP_ID and the REALTIME_APP_SECRET secret", 503);
    if (party.status === "ended") return err("this party has ended", 410);
    const body = await req.json<any>().catch(() => ({}));
    const sid = String(body.sessionId ?? "");
    try {
      if (req.method === "POST" && op === "session") {
        const [s, ice] = await Promise.all([newSession(env), iceServers(env, Number(env.JWT_TTL_S))]);
        return json({ sessionId: s.sessionId, iceServers: ice, role: isHost ? "host" : "viewer" });
      }
      if (!sid) return err("sessionId required", 400);
      if (req.method === "POST" && op === "publish") {
        const tracks: { mid: string; trackName: string; kind: "audio" | "video" }[] = Array.isArray(body.tracks) ? body.tracks : [];
        if (!tracks.length || !body.offer?.sdp) return err("offer and tracks required", 400);
        if (tracks.some((x) => !TRACK_NAME.test(String(x.trackName)) || !x.mid)) return err("bad track name or mid", 400);
        const r = await tracksNew(env, sid, { sessionDescription: body.offer as SessionDescription, tracks: tracks.map((x) => ({ location: "local", mid: String(x.mid), trackName: x.trackName })) });
        const failed = (r.tracks ?? []).filter((x) => x.errorCode || x.error);
        // the host tells the room the full list of live tracks (each with the SFU session that publishes it), so late joiners pull everything
        await roomPost(env, partyId, "tracks", { tracks: liveTracks(body.allTracks ?? tracks.map((x) => ({ ...x, sessionId: sid }))) });
        return json({ ...r, failed });
      }
      if (req.method === "POST" && op === "pull") {
        const s = await roomState(env, partyId);
        if ((s.banned as string[] | undefined)?.includes(claims.sub)) return err("you were removed from this party", 403);
        const ht = s.hostTracks as HostTracks | null;
        if (!ht) return err("the host is not live", 409);
        // body.tracks: [{sessionId, trackName}] the viewer wants; only tracks the room lists can be pulled
        const asked: { sessionId: string; trackName: string }[] = Array.isArray(body.tracks) ? body.tracks : [];
        const want = asked.length ? ht.tracks.filter((x) => asked.some((a) => a.sessionId === x.sessionId && a.trackName === x.trackName)) : ht.tracks;
        if (!want.length) return err("no such host track", 404);
        const r = await tracksNew(env, sid, { tracks: want.map((x) => ({ location: "remote", sessionId: x.sessionId, trackName: x.trackName, ...(x.kind === "video" ? { simulcast: simulcastPref() } : {}) })) });
        return json(r);
      }
      if (req.method === "PUT" && op === "layer") {
        // viewer changes the simulcast layer of one host video track it already receives (mid on the viewer's session)
        const s = await roomState(env, partyId);
        const ht = s.hostTracks as HostTracks | null;
        const rid = String(body.rid ?? ""), mid = String(body.mid ?? "");
        if (!RID.test(rid) || !mid) return err("rid (a|b|c) and mid required", 400);
        const track = ht?.tracks.find((x) => x.sessionId === body.hostSessionId && x.trackName === body.trackName && x.kind === "video");
        if (!track) return err("no such live host video track", 404);
        const r = await tracksUpdate(env, sid, { tracks: [{ location: "remote", sessionId: track.sessionId, trackName: track.trackName, mid, simulcast: simulcastPref(rid) }] });
        return json(r);
      }
      if (req.method === "PUT" && op === "renegotiate") {
        if (!body.answer?.sdp) return err("answer required", 400);
        return json(await renegotiate(env, sid, body.answer as SessionDescription));
      }
      if (req.method === "PUT" && op === "close") {
        const mids: { mid: string }[] = (Array.isArray(body.tracks) ? body.tracks : []).map((x: any) => ({ mid: String(x.mid) }));
        let r: unknown = null;
        if (mids.length) { try { r = await closeTracks(env, sid, { tracks: mids, ...(body.offer?.sdp ? { sessionDescription: body.offer as SessionDescription } : {}), force: body.force === true || !body.offer?.sdp }); } catch (e: any) { r = { error: e.message }; } }
        const remaining = liveTracks(body.allTracks ?? []);
        await roomPost(env, partyId, "tracks", remaining.length ? { tracks: remaining } : null);
        return json({ ok: true, sfu: r, live: remaining });
      }
      return err("unknown rtc route", 404);
    } catch (e: any) { return err(e?.message ?? String(e), 502); }
  }
  return err("unknown party route", 404);
}
export type { PlayClaims };
