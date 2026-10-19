// Subtitles in a watch party are each person's own choice (2026-10-19): the host remembers one language, the viewer another,
// and while the host plays through a cue each side must show its own text, playing and parked. Needs Chrome + wrangler.
// BASE_URL, FILM (with en-us and zh-hk subtitles), HOST_RULES, WRANGLER_PROFILE, WRANGLER_CONFIG.
import { chromium } from "playwright"; import { execSync } from "node:child_process";
const ROOT = new URL("../..", import.meta.url).pathname;
const B = process.env.BASE_URL ?? "https://ztor-video.eric-tam.workers.dev", FILM = process.env.FILM, CFG = process.env.WRANGLER_CONFIG ? ` -c ${process.env.WRANGLER_CONFIG}` : "";
const PROFILE = process.env.WRANGLER_PROFILE ? { XDG_CONFIG_HOME: process.env.WRANGLER_PROFILE } : {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const tag = Date.now().toString(36);
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]; if (process.env.HOST_RULES) args.push(`--host-resolver-rules=${process.env.HOST_RULES}`);
const browser = await chromium.launch({ channel: "chrome", headless: true, args });
const page = async () => (await browser.newContext({ permissions: ["camera", "microphone"] })).newPage();
const register = async (p, name, email) => { await p.goto(`${B}/app`); await p.waitForSelector("#tUp"); await p.click("#tUp"); await p.fill("#uName", name); await p.fill("#uEmail", email); await p.fill("#uPass", "password123"); await p.click("#bUp"); await p.waitForSelector("#navUser .role", { timeout: 20000 }); };
const logOf = (p) => p.evaluate(() => document.getElementById("log")?.textContent || "");
const waitLog = async (p, re, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await logOf(p))) return true; await sleep(300); } return false; };
const H = await page(); await register(H, "Host " + tag, `psub-host-${tag}@example.com`);
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "UPDATE users SET role='host' WHERE email='psub-host-${tag}@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
const V = await page(); await register(V, "Viewer " + tag, `psub-view-${tag}@example.com`);
await H.evaluate(() => localStorage.setItem("ztor.subs", "zh-hk")); await V.evaluate(() => localStorage.setItem("ztor.subs", "en-us"));
await H.reload(); await H.waitForSelector("#bHost", { timeout: 20000 }); await H.click("#bHost"); await H.waitForSelector("#hGo"); if (FILM) await H.selectOption("#hFilm", FILM); await H.fill("#hTitle", "Subs " + tag); await H.click("#hGo");
if (!await waitLog(H, /joined .* as host/)) throw new Error("host did not join: " + await logOf(H));
const hash = await H.evaluate(() => location.hash);
await V.goto(`${B}/app${hash}`); await V.waitForSelector("#bTicketJoin", { timeout: 20000 }); await V.click("#bTicketJoin");
if (!await waitLog(V, /joined .* as viewer/)) throw new Error("viewer did not join");
await waitLog(H, /film loaded/); await waitLog(V, /film loaded/); await V.click("#bGate"); await sleep(1500);
const sel = (p) => p.evaluate(() => { const s = document.getElementById("subs"); return `${s.value} (disabled ${s.disabled})`; });
console.log(`host selector (remembered, untouched): ${await sel(H)} | viewer selector (remembered, untouched): ${await sel(V)}`);
await H.evaluate(() => { const v = document.getElementById("v"); v.currentTime = 74; return v.play(); });
const seenV = new Set(), seenH = new Set(); let last = null;
const read = (p) => p.evaluate(() => ({ t: document.getElementById("v").currentTime.toFixed(1), paused: document.getElementById("v").paused, caption: (document.querySelector("#caps")?.textContent || "").trim() }));
for (let i = 0; i < 80; i++) { await sleep(250); const [rv, rh] = await Promise.all([read(V), read(H)]); if (rv.caption) seenV.add(rv.caption); if (rh.caption) seenH.add(rh.caption); last = { rv, rh }; if (Number(rh.t) > 83) break; }
console.log(`host at ${last.rh.t} s saw: ${[...seenH].join(" / ") || "NOTHING"} (expects 阿杰！) | viewer at ${last.rv.t} s (paused ${last.rv.paused}) saw: ${[...seenV].join(" / ") || "NOTHING"} (expects Kit!)`);
await H.evaluate(() => { const v = document.getElementById("v"); v.pause(); v.currentTime = 79.8; }); await sleep(4000);
const [ph, pv] = await Promise.all([read(H), read(V)]);
console.log(`host parked at ${ph.t} s (paused ${ph.paused}) caption "${ph.caption}" | viewer at ${pv.t} s (paused ${pv.paused}) caption "${pv.caption}"`);
await V.selectOption("#subs", "off"); await sleep(800); const off = await read(V); await V.selectOption("#subs", "zh-hk"); await sleep(800); const zh = await read(V);
console.log(`viewer picks off: caption "${off.caption}" | viewer picks zh-hk: caption "${zh.caption}" | host still: "${(await read(H)).caption}"`);
H.on("dialog", d => d.accept()); await H.click("#bEnd").catch(() => {}); await sleep(800); await browser.close();
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'psub-%@example.com'); DELETE FROM party_tickets WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'psub-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'psub-%@example.com'); UPDATE parties SET status='ended' WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'psub-%@example.com') AND status!='ended'; DELETE FROM users WHERE email LIKE 'psub-%@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
