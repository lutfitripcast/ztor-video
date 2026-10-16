// Audio language in a watch party: the host picks (a remembered choice counts), every viewer follows, viewers have no selector,
// and a viewer that reconnects gets the host's language from the room. Needs Chrome + wrangler.
// Note: the packager writes 2-letter codes where one exists (eng -> en), yue stays yue. BASE_URL, FILM (encoded with more than one tagged audio track), HOST_RULES, WRANGLER_PROFILE, WRANGLER_CONFIG.
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
const state = (p) => p.evaluate(() => { const pl = window.__player(); const a = pl.getVariantTracks().find(t => t.active); const sel = document.getElementById("aud"); const wrap = sel.closest("[data-audio]"); return { selectorShown: !!wrap && !wrap.hidden, value: sel.value, active: a ? a.language : null, t: document.getElementById("v").currentTime.toFixed(1) }; });
const activeIs = async (p, lang, ms = 10000) => { const t0 = Date.now(); let s; while (Date.now() - t0 < ms) { s = await state(p); if (s.active === lang) return s; await sleep(300); } return s; };
const H = await page(); await register(H, "Host " + tag, `paud-host-${tag}@example.com`);
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "UPDATE users SET role='host' WHERE email='paud-host-${tag}@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
const V = await page(); await register(V, "Viewer " + tag, `paud-view-${tag}@example.com`);
await H.evaluate(() => localStorage.setItem("ztor.audio", "yue")); await H.reload(); await H.waitForSelector("#bHost", { timeout: 20000 }); await H.click("#bHost"); await H.waitForSelector("#hGo"); if (FILM) await H.selectOption("#hFilm", FILM); await H.fill("#hTitle", "Audio " + tag); await H.click("#hGo");
if (!await waitLog(H, /joined .* as host/)) throw new Error("host did not join: " + await logOf(H));
const hash = await H.evaluate(() => location.hash);
const joinViewer = async () => { await V.goto(`${B}/app${hash}`); await V.waitForSelector("#bTicketJoin", { timeout: 8000 }).then(() => V.click("#bTicketJoin")).catch(() => {}); /* a viewer who already holds a ticket joins on arrival */ if (!await waitLog(V, /joined .* as viewer/)) throw new Error("viewer did not join"); await waitLog(V, /film loaded/); await V.click("#bGate").catch(() => {}); await sleep(1500); };
await waitLog(H, /film loaded/); await joinViewer();
await H.evaluate(() => { const v = document.getElementById("v"); v.currentTime = 5; return v.play(); }); await sleep(2500);
let h = await activeIs(H, "yue"), v = await activeIs(V, "yue");
console.log(`host remembered yue, untouched: selector shown ${h.selectorShown}, value ${h.value}, active ${h.active} | viewer: selector shown ${v.selectorShown}, value ${v.value}, active ${v.active} at ${v.t} s`);
await H.selectOption("#aud", "en"); h = await activeIs(H, "en"); v = await activeIs(V, "en");
console.log(`host switches to en: host active ${h.active} | viewer value ${v.value}, active ${v.active} at ${v.t} s`);
await joinViewer(); v = await activeIs(V, "en");
console.log(`viewer rejoins: value ${v.value}, active ${v.active} (room says en)`);
console.log("viewer log:", (await logOf(V)).split("\n").filter(l => /audio/.test(l)).slice(-3).join(" | "));
H.on("dialog", d => d.accept()); await H.click("#bEnd").catch(() => {}); await sleep(800); await browser.close();
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'paud-%@example.com'); DELETE FROM party_tickets WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'paud-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'paud-%@example.com'); UPDATE parties SET status='ended' WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'paud-%@example.com'); DELETE FROM party_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'paud-%@example.com'); DELETE FROM users WHERE email LIKE 'paud-%@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
