import { chromium } from "playwright"; import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const OUT = new URL("./out", import.meta.url).pathname; mkdirSync(OUT, { recursive: true });   // screenshots, ignored by git
const ROOT = new URL("../..", import.meta.url).pathname;   // repo root, for wrangler commands
const B = process.env.BASE_URL ?? "https://ztor-video.mluthfi840.workers.dev"; const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const tag = Date.now().toString(36);
const out = (k, v) => console.log(k.padEnd(40), typeof v === "string" ? v : JSON.stringify(v));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const page = async () => { const c = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1280, height: 800 } }); return c.newPage(); };
const logOf = (p) => p.evaluate(() => document.getElementById("log")?.textContent || "");
const waitLog = async (p, re, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await logOf(p))) return true; await sleep(300); } return false; };
const register = async (p, name, email) => { await p.goto(`${B}/app`); await p.waitForSelector("#tUp"); await p.click("#tUp"); await p.fill("#uName", name); await p.fill("#uEmail", email); await p.fill("#uPass", "password123"); await p.click("#bUp"); await p.waitForSelector("#navUser .role"); };
const H = await page(); await register(H, "Host " + tag, `host-${tag}@example.com`);
execSync(`npx wrangler d1 execute ztor-video --remote --command "UPDATE users SET role='host' WHERE email='host-${tag}@example.com'"`, { cwd: ROOT, stdio: "ignore" });
await H.reload(); await H.waitForSelector("#bHost"); await sleep(1500); await H.click("#bHost"); await H.waitForSelector("#hGo"); await H.click("#hGo"); await waitLog(H, /room connected/);
const V = await page(); await register(V, "Viewer " + tag, `viewer-${tag}@example.com`);
const hash = await H.evaluate(() => location.hash); await V.goto(`${B}/app${hash}`); await V.waitForSelector("#bTicketJoin"); await V.click("#bTicketJoin"); await waitLog(V, /room connected/); await V.click("#bGate");
const tiles = (p) => p.evaluate(() => { const cs = (id) => getComputedStyle(document.getElementById(id)); const cam = document.getElementById("cam").getBoundingClientRect(), stage = document.querySelector(".screen").getBoundingClientRect(); return { cam: cs("cam").display, camSize: `${Math.round(cam.width)}x${Math.round(cam.height)} (${Math.round(100 * cam.width / stage.width)}% of stage)`, pill: cs("micPill").display, micBtn: document.getElementById("bMic")?.textContent, camBtn: document.getElementById("bCam")?.className, feed: document.getElementById("rtc").textContent }; });
const inbound = (p) => p.evaluate(async () => { const r = []; for (const c of window.__party.viewerConns.values()) { const st = await c.pc.getStats(); st.forEach(s => { if (s.type === "inbound-rtp") r.push(`${s.kind}:${s.bytesReceived}B`); }); } return r.join(" "); });
// 1. mic only
await sleep(1500); await H.click("#bMic"); const m1 = await waitLog(H, /published mic on/, 30000); out("host mic only published", m1); if (!m1) console.log("HOST LOG:\n" + (await logOf(H)).split("\n").slice(-8).join("\n")); await sleep(5000);
out("host self view (mic only)", await tiles(H)); out("viewer (mic only)", await tiles(V)); out("viewer inbound", await inbound(V));
// 2. camera on (replaces mic-only)
await H.click("#bCam"); out("host camera published", await waitLog(H, /published cam, mic on/)); await sleep(6000);
out("host self view (camera)", await tiles(H)); out("viewer (camera)", await tiles(V)); out("viewer inbound", await inbound(V));
await V.screenshot({ path: `${OUT}/viewer-cam.png` });
// 3. mute mic while camera on
await H.click("#bMic"); await sleep(1000); out("host after mute", await tiles(H));
await H.click("#bMic"); await sleep(1000);
// 4. camera off -> falls back to mic only
await H.click("#bCam"); out("host back to mic only", await waitLog(H, /stopped cam, mic[\s\S]*published mic on/, 20000)); await sleep(5000);
out("host self view (after cam off)", await tiles(H)); out("viewer (after cam off)", await tiles(V)); out("viewer inbound", await inbound(V));
// 5. mic off
await H.click("#bMic"); out("host mic off", await waitLog(H, /stopped mic/, 10000)); await sleep(3000);
out("viewer (silent)", await tiles(V));
H.once("dialog", d => d.accept()); await H.click("#bEnd"); await sleep(1500);
execSync(`npx wrangler d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'); DELETE FROM party_tickets WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'); DELETE FROM users WHERE email LIKE '%@example.com'"`, { cwd: ROOT, stdio: "ignore" });
await browser.close();
