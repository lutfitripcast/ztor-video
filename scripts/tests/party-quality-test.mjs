// Picture quality in a watch party on an unthrottled link: which rung the host and the viewer settle on, and how fast
// they climb. Full-size window so Shaka's size rules (if any) do not cap the rung. BASE_URL, FILM, HOST_RULES, WRANGLER_PROFILE, WRANGLER_CONFIG.
import { chromium } from "playwright"; import { execSync } from "node:child_process";
const ROOT = new URL("../..", import.meta.url).pathname;
const B = process.env.BASE_URL ?? "https://ztor-video.eric-tam.workers.dev", FILM = process.env.FILM, CFG = process.env.WRANGLER_CONFIG ? ` -c ${process.env.WRANGLER_CONFIG}` : "";
const PROFILE = process.env.WRANGLER_PROFILE ? { XDG_CONFIG_HOME: process.env.WRANGLER_PROFILE } : {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const tag = Date.now().toString(36);
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]; if (process.env.HOST_RULES) args.push(`--host-resolver-rules=${process.env.HOST_RULES}`);
const browser = await chromium.launch({ channel: "chrome", headless: true, args });
const page = async () => (await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1920, height: 1080 } })).newPage();
const register = async (p, name, email) => { await p.goto(`${B}/app`); await p.waitForSelector("#tUp"); await p.click("#tUp"); await p.fill("#uName", name); await p.fill("#uEmail", email); await p.fill("#uPass", "password123"); await p.click("#bUp"); await p.waitForSelector("#navUser .role", { timeout: 20000 }); };
const logOf = (p) => p.evaluate(() => document.getElementById("log")?.textContent || "");
const waitLog = async (p, re, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await logOf(p))) return true; await sleep(300); } return false; };
const H = await page(); await register(H, "Host " + tag, `pq-host-${tag}@example.com`);
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "UPDATE users SET role='host' WHERE email='pq-host-${tag}@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
const V = await page(); await register(V, "Viewer " + tag, `pq-view-${tag}@example.com`);
await H.reload(); await H.waitForSelector("#bHost", { timeout: 20000 }); await H.click("#bHost"); await H.waitForSelector("#hGo"); if (FILM) await H.selectOption("#hFilm", FILM); await H.fill("#hTitle", "Quality " + tag); await H.click("#hGo");
if (!await waitLog(H, /joined .* as host/)) throw new Error("host did not join: " + await logOf(H));
const hash = await H.evaluate(() => location.hash);
await V.goto(`${B}/app${hash}`); await V.waitForSelector("#bTicketJoin", { timeout: 20000 }); await V.click("#bTicketJoin");
if (!await waitLog(V, /joined .* as viewer/)) throw new Error("viewer did not join");
await waitLog(H, /film loaded/); await waitLog(V, /film loaded/); await V.click("#bGate").catch(() => {}); await sleep(1000);
const q = (p) => p.evaluate(() => { const pl = window.__player(); const a = pl.getVariantTracks().find(t => t.active); const st = pl.getStats(); const v = document.getElementById("v"); let ahead = 0; try { const b = v.buffered; if (b.length) ahead = b.end(b.length - 1) - v.currentTime; } catch {} return { h: a ? a.height : 0, kbps: a ? Math.round(a.bandwidth / 1000) : 0, est: Math.round(st.estimatedBandwidth / 1000), ahead: ahead.toFixed(0), box: `${v.clientWidth}x${v.clientHeight}`, rungs: pl.getVariantTracks().map(t => t.height).filter((x, i, arr) => arr.indexOf(x) === i).sort((a, b) => a - b).join("/") }; });
console.log("rungs offered:", (await q(H)).rungs, "| video box host", (await q(H)).box, "viewer", (await q(V)).box);
await H.evaluate(() => { const v = document.getElementById("v"); v.currentTime = 120; return v.play(); });
const rows = [];
for (let t = 5; t <= 90; t += 5) { await sleep(5000); const [h, v] = await Promise.all([q(H), q(V)]); rows.push(`${t}s H ${h.h}p/${h.kbps}k(est ${h.est}k, buf ${h.ahead}s) V ${v.h}p/${v.kbps}k(est ${v.est}k, buf ${v.ahead}s)`); }
console.log(rows.join("\n"));
console.log("viewer quality log:", (await logOf(V)).split("\n").filter(l => /quality|guard/.test(l)).map(l => l.replace(/^\[[^\]]*\] /, "")).slice(-6).join(" | "));
console.log("host quality log:", (await logOf(H)).split("\n").filter(l => /quality|guard/.test(l)).map(l => l.replace(/^\[[^\]]*\] /, "")).slice(-6).join(" | "));
H.on("dialog", d => d.accept()); await H.click("#bEnd").catch(() => {}); await sleep(800); await browser.close();
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pq-%@example.com'); DELETE FROM party_tickets WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pq-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pq-%@example.com'); UPDATE parties SET status='ended' WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'pq-%@example.com') AND status!='ended'; DELETE FROM users WHERE email LIKE 'pq-%@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
