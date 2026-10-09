import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = new URL("./out", import.meta.url).pathname; mkdirSync(OUT, { recursive: true });   // screenshots, ignored by git
const B = process.env.BASE_URL ?? "https://ztor-video.mluthfi840.workers.dev", FILM = process.env.FILM ?? "439662d9-e97b-44f5-9ae1-7bd346553e4b";
const j = async (m, p, body, h = {}) => { const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", ...h }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = (k, v) => console.log(k.padEnd(34), typeof v === "string" ? v : JSON.stringify(v));
await j("POST", "/test/rent", { userId: "host-1", filmId: FILM, hours: 2 }); await j("POST", "/test/rent", { userId: "fan-1", filmId: FILM, hours: 2 });
const c = await j("POST", "/party", { hostId: "host-1", filmId: FILM, title: "headless browser test" }); const id = c.b.partyId; out("party", id);

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
const logOf = (page) => page.evaluate(() => document.getElementById("log").textContent);
const waitLog = async (page, re, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const l = await logOf(page); if (re.test(l)) return true; await sleep(300); } return false; };
const errs = { host: [], fan: [] };

const host = await ctx.newPage(); host.on("pageerror", e => errs.host.push(e.message)); host.on("console", m => { if (m.type() === "error") errs.host.push(m.text().slice(0, 160)); });
await host.goto(`${B}/watch?party=${id}&user=host-1`);
out("host joined", await waitLog(host, /joined as host/));
out("host film loaded", await waitLog(host, /film loaded/, 30000));
await host.click("#bCam");
out("host published cam+mic", await waitLog(host, /published cam, mic/, 20000));
out("host webrtc connected", await waitLog(host, /webrtc connected/, 15000));

const fan = await ctx.newPage(); fan.on("pageerror", e => errs.fan.push(e.message)); fan.on("console", m => { if (m.type() === "error") errs.fan.push(m.text().slice(0, 160)); });
await fan.goto(`${B}/watch?party=${id}&user=fan-1`);
out("fan joined", await waitLog(fan, /joined as viewer/));
out("fan pulling", await waitLog(fan, /pulling cam, mic/, 20000));
out("fan receiving cam", await waitLog(fan, /receiving cam \(video\)/, 20000));
out("fan receiving mic", await waitLog(fan, /receiving mic \(audio\)/, 20000));
out("fan webrtc connected", await waitLog(fan, /webrtc connected/, 15000));
await fan.click("#bGate");
// host presses play; viewer should follow
await host.evaluate(() => { const v = document.getElementById("v"); v.currentTime = 5; return v.play(); });
await sleep(8000);
const hv = await host.evaluate(() => ({ t: document.getElementById("v").currentTime, paused: document.getElementById("v").paused }));
const fv = await fan.evaluate(() => ({ t: document.getElementById("v").currentTime, paused: document.getElementById("v").paused, sync: document.getElementById("sync").textContent, clk: document.getElementById("clk").textContent, res: document.getElementById("res").textContent, kbps: document.getElementById("kbps").textContent, live: document.getElementById("bLive").textContent, viewers: document.getElementById("viewers").textContent, camVisible: getComputedStyle(document.getElementById("cam")).display !== "none", camSize: `${document.getElementById("cam").videoWidth}x${document.getElementById("cam").videoHeight}` }));
out("host video", hv); out("fan video", fv);
const inbound = await fan.evaluate(async () => { const st = await allPcs()[0].getStats(); const r = []; st.forEach(s => { if (s.type === "inbound-rtp") r.push({ kind: s.kind, bytes: s.bytesReceived, packets: s.packetsReceived, frames: s.framesDecoded, w: s.frameWidth, h: s.frameHeight }); }); return r; });
out("fan inbound-rtp", inbound);
const outbound = await host.evaluate(async () => { const st = await allPcs()[0].getStats(); const r = []; st.forEach(s => { if (s.type === "outbound-rtp") r.push({ kind: s.kind, bytes: s.bytesSent, w: s.frameWidth, h: s.frameHeight, fps: s.framesPerSecond }); }); return r; });
out("host outbound-rtp", outbound);
// host pauses; viewer should pause and match
await host.evaluate(() => document.getElementById("v").pause()); await sleep(2500);
out("after host pause", await fan.evaluate(() => ({ paused: document.getElementById("v").paused, sync: document.getElementById("sync").textContent })));
// chat both ways + pin
await fan.fill("#text", "hi from the headless fan"); await fan.click("#bSend"); await sleep(800);
out("host sees fan chat", await host.evaluate(() => [...document.querySelectorAll("#msgs .m .txt")].map(e => e.textContent)));
await host.hover("#msgs .m:last-child"); await host.click("#msgs .m:last-child button[data-a=pin]"); await sleep(800);
out("fan sees pin", await fan.evaluate(() => document.getElementById("pinned").textContent));
// host turns camera off -> viewer's tile hides
await host.click("#bCam"); out("host stopped", await waitLog(host, /stopped cam, mic -> 200/, 15000)); await sleep(2500);
out("fan cam hidden after stop", await fan.evaluate(() => getComputedStyle(document.getElementById("cam")).display === "none"));
out("fan LIVE badge after stop", await fan.evaluate(() => document.getElementById("bLive").textContent));
// camera restart: new track names, viewer pulls again
await host.click("#bCam"); out("host re-published", await waitLog(host, /published cam, mic[\s\S]*published cam, mic/, 20000));
out("fan re-receiving cam", await waitLog(fan, /receiving cam \(video\)[\s\S]*receiving cam \(video\)/, 30000)); await sleep(5000);
out("fan cam visible again", await fan.evaluate(() => ({ visible: getComputedStyle(document.getElementById("cam")).display !== "none", kbps: document.getElementById("kbps").textContent, feed: document.getElementById("rtc").textContent })));
await host.screenshot({ path: `${OUT}/host.png` }); await fan.screenshot({ path: `${OUT}/fan.png` });
out("page errors", errs);
console.log("---- fan log ----\n" + (await logOf(fan)).split("\n").slice(-14).join("\n"));
await j("POST", `/party/${id}/end`, {}, { authorization: "Bearer " + (await host.evaluate(() => me.token)) });
await browser.close();
