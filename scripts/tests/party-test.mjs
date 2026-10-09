const B = process.env.BASE_URL ?? "https://ztor-video.mluthfi840.workers.dev";
const FILM = process.env.FILM ?? "439662d9-e97b-44f5-9ae1-7bd346553e4b";
const j = async (m, p, body, h = {}, tries = 3) => { try { return await j1(m, p, body, h); } catch (e) { if (tries > 1) { await sleep(1500); return j(m, p, body, h, tries - 1); } throw e; } };
const j1 = async (m, p, body, h = {}) => { const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", ...h }, body: body ? JSON.stringify(body) : undefined }); let b; try { b = await r.clone().json(); } catch { b = await r.text(); } return { s: r.status, b }; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = (k, v) => console.log(k.padEnd(46), typeof v === "string" ? v : JSON.stringify(v));
const wsFail = (url) => new Promise((res) => { const w = new WebSocket(url); w.addEventListener("open", () => { w.close(); res("opened (unexpected)"); }); w.addEventListener("error", () => res("handshake refused")); });
const wsOpen = (url) => new Promise((res, rej) => { const w = new WebSocket(url); const got = []; w.addEventListener("message", e => { if (e.data !== "pong") got.push(JSON.parse(e.data)); }); w.addEventListener("open", () => res({ w, got })); w.addEventListener("error", rej); w.addEventListener("close", e => { w.closeCode = e.code; }); });

// 0. existing console untouched
out("existing /health", (await j("GET", "/health")).s);
out("existing /player", (await fetch(B + "/player")).status);
out("existing /test/films", (await j("GET", "/test/films")).s);
out("existing manifest w/o pass (expect 401)", (await j("GET", `/media/${FILM}/v6/manifest.mpd`)).s);
out("new /watch page", (await fetch(B + "/watch")).status);

// 1. create
await j("POST", "/test/rent", { userId: "host-1", filmId: FILM, hours: 2 });
const noRent = await j("POST", "/party", { hostId: "nobody-" + Date.now(), filmId: FILM }); out("create without rental (expect 402)", noRent.s);
const c = await j("POST", "/party", { hostId: "host-1", filmId: FILM, title: "e2e test party" }); out("create party", `${c.s} ${c.b.partyId} ${c.b.watchUrl}`);
const id = c.b.partyId;
out("GET /party/id", (await j("GET", `/party/${id}`)).b);

// 2. join
const j402 = await j("POST", `/party/${id}/join`, { userId: "fan-norent" }); out("join without ticket (expect 402)", j402.s);
await j("POST", "/test/rent", { userId: "fan-1", filmId: FILM, hours: 2 });
out("join with rental but no ticket (expect 402)", (await j("POST", `/party/${id}/join`, { userId: "fan-1" })).s);
out("get ticket", (await j("POST", `/party/${id}/ticket`, { userId: "fan-1" })).s);
const host = (await j("POST", `/party/${id}/join`, { userId: "host-1", deviceId: "node" })).b; out("host join", `role=${host.role} realtime=${host.realtime}`);
const fan = (await j("POST", `/party/${id}/join`, { userId: "fan-1", deviceId: "node" })).b; out("fan join", `role=${fan.role}`);
out("fan pass opens own film hls", (await fetch(fan.hls)).status);
out("fan pass on other film (expect 401)", (await fetch(`${B}/media/other/v1/url/master.m3u8?t=${fan.token}`)).status);
out("rtc/session unconfigured (expect 503)", (await j("POST", `/party/${id}/rtc/session`, {}, { authorization: "Bearer " + fan.token })).s);
out("rtc/publish as viewer (expect 403)", (await j("POST", `/party/${id}/rtc/publish`, { sessionId: "x" }, { authorization: "Bearer " + fan.token })).s);
out("ws without ticket (expect refused)", await wsFail(`${B.replace("https","wss")}/party/${id}/ws`));

// 3. websockets
const H = await wsOpen(host.ws), F = await wsOpen(fan.ws); await sleep(700);
out("host hello", H.got[0]?.t + " viewers=" + H.got[0]?.viewers);
out("fan hello", F.got[0]?.t + " role=" + F.got[0]?.you?.role);
H.w.send(JSON.stringify({ t: "time", c: Date.now() }));
H.w.send(JSON.stringify({ t: "clock", state: "playing", position: 42.5, rate: 1 }));
F.w.send(JSON.stringify({ t: "clock", state: "playing", position: 9999 }));
F.w.send(JSON.stringify({ t: "chat", text: "hello from fan" }));
F.w.send(JSON.stringify({ t: "chat", text: "too fast" }));
H.w.send(JSON.stringify({ t: "chat", text: "welcome" }));
await sleep(1000);
const fanClock = F.got.filter(m => m.t === "clock").pop(); out("fan received host clock", fanClock?.clock);
out("fan clock attempt refused", F.got.find(m => m.t === "error" && m.code === "forbidden")?.detail);
out("fan chat rate refusal", F.got.find(m => m.t === "error" && m.code === "rate")?.detail);
const chats = H.got.filter(m => m.t === "chat").map(m => `${m.msg.seq}:${m.msg.userId}:${m.msg.text}`); out("host saw chats", chats);
const fanSeq = H.got.find(m => m.t === "chat" && m.msg.userId === "fan-1")?.msg.seq;
H.w.send(JSON.stringify({ t: "pin", seq: fanSeq })); await sleep(800);
out("fan got pin", F.got.filter(m => m.t === "pin").pop()?.pinned?.text);
out("  debug fanSeq / host msgs", `${fanSeq} | ` + H.got.map(m => m.t + (m.code ? ":" + m.code + ":" + m.detail : "")).join(","));
out("  debug fan msgs", F.got.map(m => m.t + (m.code ? ":" + m.code : "")).join(","));
H.w.send(JSON.stringify({ t: "slow", seconds: 15 })); await sleep(400); out("fan got slow", F.got.filter(m => m.t === "slow").pop()?.slowModeS);
// late joiner sees recent + pinned + clock
const late = (await j("POST", `/party/${id}/join`, { userId: "host-1" })).b; const L = await wsOpen(late.ws); await sleep(600);
out("late joiner hello", `recent=${L.got[0]?.recent?.length} pinned=${!!L.got[0]?.pinned} clock=${L.got[0]?.clock?.position} viewers=${L.got[0]?.viewers}`); L.w.close();
// kick
H.w.send(JSON.stringify({ t: "kick", userId: "fan-1" })); await sleep(800);
out("fan socket close code (expect 4001)", F.w.closeCode);
out("fan rejoin (expect 403)", (await j("POST", `/party/${id}/join`, { userId: "fan-1" })).s);
out("fan ws with old ticket (expect refused)", await wsFail(fan.ws));
await sleep(4000);   // one alarm tick: chat + actions flushed to D1
out("D1 archive", (await j("GET", `/party/${id}/messages`, null, { authorization: "Bearer " + host.token })).b.map(m => `${m.seq}:${m.user_id}:${m.text}`));
// end
out("end as host", (await j("POST", `/party/${id}/end`, {}, { authorization: "Bearer " + host.token })).b);
await sleep(500); out("host socket close code (expect 4000)", H.w.closeCode);
out("join after end (expect 410)", (await j("POST", `/party/${id}/join`, { userId: "host-1" })).s);
out("GET /party/id after end", (await j("GET", `/party/${id}`)).b.status);
process.exit(0);
