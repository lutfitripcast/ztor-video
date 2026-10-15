// Subtitles for a viewer in a watch party: the viewer picks a language, the host plays through a cue, the viewer must show it.
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
await H.evaluate(() => localStorage.setItem("ztor.subs", "zh-hk")); await H.reload(); await H.waitForSelector("#bHost", { timeout: 20000 }); await H.click("#bHost"); await H.waitForSelector("#hGo"); if (FILM) await H.selectOption("#hFilm", FILM); await H.fill("#hTitle", "Subs " + tag); await H.click("#hGo");
if (!await waitLog(H, /joined .* as host/)) throw new Error("host did not join: " + await logOf(H));
const hash = await H.evaluate(() => location.hash);
await V.goto(`${B}/app${hash}`); await V.waitForSelector("#bTicketJoin", { timeout: 20000 }); await V.click("#bTicketJoin");
if (!await waitLog(V, /joined .* as viewer/)) throw new Error("viewer did not join");
await waitLog(H, /film loaded/); await waitLog(V, /film loaded/); await V.click("#bGate"); await sleep(1500);
console.log("viewer selector:", await V.evaluate(() => [...document.querySelectorAll("#subs option")].map(o => `${o.value}=${o.textContent}`).join(", ")), "| disabled:", await V.evaluate(() => document.getElementById("subs").disabled));
console.log("host selector:  ", await H.evaluate(() => [...document.querySelectorAll("#subs option")].map(o => o.value).join(", ")));
await sleep(1500); console.log("host selector shows (remembered, untouched):", await H.evaluate(() => document.getElementById("subs").value)); console.log("viewer follows host:", await V.evaluate(() => `${document.getElementById("subs").value} (selector disabled: ${document.getElementById("subs").disabled})`));
await H.evaluate(() => { const v = document.getElementById("v"); v.currentTime = 74; return v.play(); });
const seenV = new Set(), seenH = new Set(); let last = null;
for (let i = 0; i < 80; i++) { await sleep(250); const [rv, rh] = await Promise.all([V, H].map(p => p.evaluate(() => { const v = document.getElementById("v"); const out = []; const caps = document.querySelector("#caps"); if (caps && caps.textContent.trim()) out.push(caps.textContent.trim()); for (const tr of v.textTracks) if (tr.mode === "showing") for (const c of tr.activeCues || []) out.push(c.text); return { t: v.currentTime.toFixed(1), paused: v.paused, cues: out, modes: [...v.textTracks].map(t => `${t.language || t.label}:${t.mode}`) }; }))); rv.cues.forEach(c => seenV.add(c)); rh.cues.forEach(c => seenH.add(c)); last = { rv, rh }; if (Number(rh.t) > 83) break; }
console.log(`host at ${last.rh.t} s saw: ${[...seenH].join(" / ") || "nothing"} | viewer at ${last.rv.t} s (paused ${last.rv.paused}) saw: ${[...seenV].join(" / ") || "NOTHING"} | viewer tracks: ${last.rv.modes.join(", ")}`);
// deterministic: the host parks inside the cue; both sides must display it while paused
await H.evaluate(() => { const v = document.getElementById("v"); v.pause(); v.currentTime = 79.8; }); await sleep(4000);
const [ph, pv] = await Promise.all([H, V].map(p => p.evaluate(() => ({ t: document.getElementById("v").currentTime.toFixed(1), paused: document.getElementById("v").paused, caption: (document.querySelector("#caps")?.textContent || "").trim() }))));
console.log(`host parked at ${ph.t} s (paused ${ph.paused}) caption "${ph.caption}" | viewer at ${pv.t} s (paused ${pv.paused}) caption "${pv.caption}"`);
const diag = await V.evaluate(() => { const p = window.__player(); const tt = p.getTextTracks().map(t => `${t.language}:${t.active ? "active" : "-"}`); const before = (document.querySelector("#caps")?.textContent || "").trim(); return { textTracks: tt, visible: p.isTextTrackVisible(), capsChildren: document.querySelector("#caps")?.children.length, before }; });
console.log("viewer diag at the parked frame:", JSON.stringify(diag));
const after = await V.evaluate(async () => { const p = window.__player(); p.setTextTrackVisibility(false); await new Promise(r => setTimeout(r, 300)); p.setTextTrackVisibility(true); await new Promise(r => setTimeout(r, 2500)); return (document.querySelector("#caps")?.textContent || "").trim(); });
console.log("viewer caption after an off/on toggle at the same frame:", JSON.stringify(after));
console.log("viewer log:", (await logOf(V)).split("\n").filter(l => /subtitle|resync|follow|seeked/.test(l)).slice(-8).join(" | "));
H.on("dialog", d => d.accept()); await H.click("#bEnd").catch(() => {}); await sleep(800); await browser.close();
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'psub-%@example.com'); DELETE FROM party_tickets WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'psub-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'psub-%@example.com'); UPDATE parties SET status='ended' WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'psub-%@example.com') AND status!='ended'; DELETE FROM users WHERE email LIKE 'psub-%@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
