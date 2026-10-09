import { chromium } from "playwright";
const B = process.env.BASE_URL ?? "https://ztor-video.mluthfi840.workers.dev", FILM = process.env.FILM ?? "439662d9-e97b-44f5-9ae1-7bd346553e4b";
const j = async (m, p, body, h = {}) => { const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", ...h }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = (k, v) => console.log(k.padEnd(34), typeof v === "string" ? v : JSON.stringify(v));
const c = await j("POST", "/party", { hostId: "host-1", filmId: FILM, title: "screen + reload test" }); const id = c.b.partyId; out("party", id);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--auto-select-desktop-capture-source=Entire screen", "--auto-accept-this-tab-capture"] });
const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
const logOf = (page) => page.evaluate(() => document.getElementById("log").textContent);
const waitLog = async (page, re, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await logOf(page))) return true; await sleep(300); } return false; };
const tiles = (pg) => pg.evaluate(() => ({ cam: getComputedStyle(document.getElementById("cam")).display, screen: getComputedStyle(document.getElementById("screen")).display, screenSize: `${document.getElementById("screen").videoWidth}x${document.getElementById("screen").videoHeight}`, feed: document.getElementById("rtc").textContent, conns: viewerConns.size, kbps: document.getElementById("kbps").textContent }));
const host = await ctx.newPage(); await host.goto(`${B}/watch?party=${id}&user=host-1`); await waitLog(host, /room connected/);
await host.click("#bCam"); out("host cam", await waitLog(host, /published cam, mic/));
const fan = await ctx.newPage(); await fan.goto(`${B}/watch?party=${id}&user=fan-1`); await waitLog(fan, /room connected/); await fan.click("#bGate");
out("fan cam", await waitLog(fan, /receiving mic/));
// screen share on top of the camera: a second host session; viewer opens a second connection
await host.click("#bScreen"); const shared = await waitLog(host, /published screen/, 15000); out("host screen published", shared);
if (!shared) console.log("host log:", (await logOf(host)).split("\n").slice(-3).join(" | "));
out("fan receives screen", await waitLog(fan, /receiving screen \(video\)/, 30000)); await sleep(5000);
out("fan tiles with cam+screen", await tiles(fan));
await host.click("#bScreen"); out("host screen stopped", await waitLog(host, /stopped screen/, 15000)); await sleep(3000);
out("fan tiles after screen stop", await tiles(fan));
// host reloads the page mid-party: new sessions, viewer should drop the old one and pull the new one
await host.reload(); await waitLog(host, /room connected/); await sleep(2000);
out("fan after host reload (cam gone?)", await tiles(fan));
await host.click("#bCam"); out("host cam again after reload", await waitLog(host, /published cam, mic/));
out("fan re-receives cam", await waitLog(fan, /receiving cam \(video\)[\s\S]*receiving cam \(video\)/, 30000)); await sleep(5000);
out("fan tiles after reload+cam", await tiles(fan));
// late joiner while cam is live
const late = await ctx.newPage(); await late.goto(`${B}/watch?party=${id}&user=fan-2`);
await j("POST", "/test/rent", { userId: "fan-2", filmId: FILM, hours: 1 }); await late.goto(`${B}/watch?party=${id}&user=fan-2`); await waitLog(late, /room connected/); await late.click("#bGate");
out("late joiner receives cam", await waitLog(late, /receiving cam \(video\)/, 30000));
console.log("---- fan log tail ----\n" + (await logOf(fan)).split("\n").slice(-12).join("\n"));
await j("POST", `/party/${id}/end`, {}, { authorization: "Bearer " + (await host.evaluate(() => me.token)) });
await browser.close();
