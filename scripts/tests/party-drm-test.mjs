// DRM party (2026-10-19): the host creates a party on the film's DRM version, the viewer joins with a ticket (no rental),
// both take vendor licenses and play in sync. Needs the real Chrome (Widevine) started over CDP, two instances. BASE_URL,
// FILM (with a DRM version), HOST_RULES, WRANGLER_PROFILE, WRANGLER_CONFIG.
import { chromium } from "playwright"; import { execSync, spawn } from "node:child_process";
const ROOT = new URL("../..", import.meta.url).pathname;
const B = process.env.BASE_URL ?? "https://ztor-video.eric-tam.workers.dev", FILM = process.env.FILM, CFG = process.env.WRANGLER_CONFIG ? ` -c ${process.env.WRANGLER_CONFIG}` : "";
const PROFILE = process.env.WRANGLER_PROFILE ? { XDG_CONFIG_HOME: process.env.WRANGLER_PROFILE } : {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const tag = Date.now().toString(36);
const args = ["--headless=new", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run"]; if (process.env.HOST_RULES) args.push(`--host-resolver-rules=${process.env.HOST_RULES}`);
const chromes = [];
const realChrome = async (port) => { const c = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [...args, `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/cdp-profile-${port}`, "about:blank"], { stdio: "ignore" }); chromes.push(c); for (let i = 0; i < 40; i++) { try { await (await fetch(`http://localhost:${port}/json/version`)).json(); break; } catch { await sleep(500); } } const b = await chromium.connectOverCDP(`http://localhost:${port}`); return { b, p: await b.contexts()[0].newPage() }; };
const register = async (p, name, email) => { await p.goto(`${B}/app`); await p.waitForSelector("#tUp"); await p.click("#tUp"); await p.fill("#uName", name); await p.fill("#uEmail", email); await p.fill("#uPass", "password123"); await p.click("#bUp"); await p.waitForSelector("#navUser .role", { timeout: 20000 }); };
const logOf = (p) => p.evaluate(() => document.getElementById("log")?.textContent || "");
const waitLog = async (p, re, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await logOf(p))) return true; await sleep(300); } return false; };
const hc = await realChrome(9341), vc = await realChrome(9342); const H = hc.p, V = vc.p;
await register(H, "Host " + tag, `pdrm-host-${tag}@example.com`);
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "UPDATE users SET role='host' WHERE email='pdrm-host-${tag}@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
await register(V, "Viewer " + tag, `pdrm-view-${tag}@example.com`);
await H.reload(); await H.waitForSelector("#bHost", { timeout: 20000 }); await H.click("#bHost"); await H.waitForSelector("#hGo"); if (FILM) await H.selectOption("#hFilm", FILM); await H.selectOption("#hProt", "drm"); await H.fill("#hTitle", "DRM " + tag); await H.click("#hGo");
if (!await waitLog(H, /joined .* as host/)) throw new Error("host did not join: " + await logOf(H));
console.log("host join line:", (await logOf(H)).split("\n").find(l => /joined/.test(l))?.replace(/^\[[^\]]*\] /, ""));
const hash = await H.evaluate(() => location.hash);
await V.goto(`${B}/app${hash}`); await V.waitForSelector("#bTicketJoin", { timeout: 20000 }); await V.click("#bTicketJoin");
if (!await waitLog(V, /joined .* as viewer/)) throw new Error("viewer did not join: " + await logOf(V));
const hl = await waitLog(H, /film loaded/), vl = await waitLog(V, /film loaded/);
console.log(`film loaded: host ${hl} viewer ${vl} | host: ${(await logOf(H)).split("\n").filter(l => /film loaded|license|error/i.test(l)).map(l => l.replace(/^\[[^\]]*\] /, "")).join(" | ")}`);
await V.click("#bGate").catch(() => {}); await sleep(1500);
await H.evaluate(() => { const v = document.getElementById("v"); v.currentTime = 60; return v.play(); });
const sync = (p) => p.evaluate(() => { const s = window.__sync(); return { t: s.t, paused: s.paused, rs: s.rs, lic: window.__licenses ? window.__licenses() : null }; });
const samples = []; for (let i = 0; i < 12; i++) { await sleep(1000); const [h, v] = await Promise.all([sync(H), sync(V)]); samples.push(`${(v.t - h.t).toFixed(2)}${v.paused ? "(viewer paused)" : ""}`); }
const [h, v] = await Promise.all([sync(H), sync(V)]);
console.log(`viewer-host every 1 s: ${samples.join(" ")} | licenses: host ${h.lic} viewer ${v.lic} | viewer readyState ${v.rs}`);
console.log("viewer log:", (await logOf(V)).split("\n").filter(l => /license|error|follow|health/i.test(l)).slice(-5).map(l => l.replace(/^\[[^\]]*\] /, "")).join(" | "));
H.on("dialog", d => d.accept()); await H.click("#bEnd").catch(() => {}); await sleep(800); await hc.b.close(); await vc.b.close(); chromes.forEach(c => c.kill());
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pdrm-%@example.com'); DELETE FROM party_tickets WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pdrm-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pdrm-%@example.com'); DELETE FROM licenses WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pdrm-%@example.com'); UPDATE parties SET status='ended' WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'pdrm-%@example.com') AND status!='ended'; DELETE FROM users WHERE email LIKE 'pdrm-%@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
