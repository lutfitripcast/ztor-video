// Host scrubs the progress bar (a burst of seeks) while playing and while paused, with the camera on and off; measures
// viewer minus host afterwards. Also: host page reload while playing. Needs Chrome + wrangler. BASE_URL overrides the Worker.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
const ROOT = new URL("../..", import.meta.url).pathname;
const B = process.env.BASE_URL ?? "https://ztor-video.mluthfi840.workers.dev";   // HOST_RULES pins its address on networks whose DNS hijacks workers.dev
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tag = Date.now().toString(36);
const launchArgs = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]; if (process.env.HOST_RULES) launchArgs.push(`--host-resolver-rules=${process.env.HOST_RULES}`);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: launchArgs });
const page = async () => { const c = await browser.newContext({ permissions: ["camera", "microphone"] }); return c.newPage(); };
const register = async (p, name, email) => { await p.goto(`${B}/app`); await p.waitForSelector("#tUp"); await p.click("#tUp"); await p.fill("#uName", name); await p.fill("#uEmail", email); await p.fill("#uPass", "password123"); await p.click("#bUp"); await p.waitForSelector("#navUser .role", { timeout: 20000 }); };
const logOf = (p) => p.evaluate(() => document.getElementById("log")?.textContent || "");
const waitLog = async (p, re, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await logOf(p))) return true; await sleep(300); } return false; };
const H = await page(); await register(H, "Host " + tag, `scrub-host-${tag}@example.com`);
const hostCdp = await H.context().newCDPSession(H); await hostCdp.send("Network.enable");
const throttleHost = (on) => hostCdp.send("Network.emulateNetworkConditions", on ? { offline: false, latency: 700, downloadThroughput: 4e6 / 8, uploadThroughput: 2e6 / 8 } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
execSync(`npx wrangler d1 execute ztor-video --remote --command "UPDATE users SET role='host' WHERE email='scrub-host-${tag}@example.com'"`, { cwd: ROOT, stdio: "ignore" });
const V = await page(); await register(V, "Viewer " + tag, `scrub-view-${tag}@example.com`);
await H.reload(); await H.waitForSelector("#bHost", { timeout: 20000 }); await H.click("#bHost"); await H.waitForSelector("#hGo"); await H.fill("#hTitle", "Scrub " + tag); await H.click("#hGo");
if (!await waitLog(H, /joined .* as host/)) throw new Error("host did not join");
const hash = await H.evaluate(() => location.hash);
await V.goto(`${B}/app${hash}`); await V.waitForSelector("#bTicketJoin", { timeout: 20000 }); await V.click("#bTicketJoin");
if (!await waitLog(V, /joined .* as viewer/)) throw new Error("viewer did not join");
await waitLog(H, /film loaded/); await waitLog(V, /film loaded/); await V.click("#bGate"); await sleep(500);
const snap = () => Promise.all([H, V].map(p => p.evaluate(() => { const v = document.getElementById("v"); return { t: v.currentTime, paused: v.paused, rs: v.readyState }; })));
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
const dbg = async () => { const [h, v] = await Promise.all([H, V].map(p => p.evaluate(() => { const s = window.__sync(); return { t: s.t.toFixed(2), paused: s.paused, rs: s.rs, rate: s.rate, exp: s.exp?.toFixed?.(2), clock: s.clock && `${s.clock.state}@${s.clock.position.toFixed(1)} age ${s.clock.local ? Date.now() - s.clock.local : "?"}ms`, oneWay: s.oneWay, voiceMs: s.voiceMs, queued: s.queued }; }))); console.log("   host  ", JSON.stringify(h)); console.log("   viewer", JSON.stringify(v)); };
const after = async (label) => { const out = []; for (const w of [1000, 2000, 3000, 4000]) { await sleep(w); const [h, v] = await snap(); out.push(`${fmt(v.t - h.t)}${v.paused !== h.paused ? "(" + (v.paused ? "viewer paused" : "viewer playing") + ")" : ""}`); } const voice = await V.evaluate(() => (document.getElementById("clk").textContent.match(/voice \+([\d.]+)/) || [0, "0"])[1]); console.log(label.padEnd(44), "viewer-host at 1,3,6,10 s:", out.join("  "), `| voice ${voice} s`); if (Math.abs(parseFloat(out[3])) > 0.5) await dbg(); };
const scrub = (to, stepMs = 120, steps = 8) => H.evaluate(async ([to, stepMs, steps]) => { const v = document.getElementById("v"); const from = v.currentTime; for (let i = 1; i <= steps; i++) { v.currentTime = from + (to - from) * i / steps; await new Promise(r => setTimeout(r, stepMs)); } }, [to, stepMs, steps]);
await H.evaluate(() => { const v = document.getElementById("v"); v.currentTime = 5; return v.play(); }); await sleep(6000);
await scrub(40); await after("scrub while playing, camera off");
await H.evaluate(() => document.getElementById("v").pause()); await sleep(2000);
const holdT = await V.evaluate(() => document.getElementById("v").currentTime);
const scrubP = scrub(20); await sleep(500); const mid = await V.evaluate(() => ({ t: document.getElementById("v").currentTime, cover: getComputedStyle(document.getElementById("hold")).display === "block" })); await scrubP;
await sleep(1600); const settled = await V.evaluate(() => getComputedStyle(document.getElementById("hold")).display === "block");
console.log(`paused scrub: snapshot cover during the drag ${mid.cover ? "shown" : "NOT shown"}, film pre-seeked to ${mid.t.toFixed(2)} s (was ${holdT.toFixed(2)} s) | 1.6 s after release cover ${settled ? "STILL shown" : "gone"}`);
await after("scrub while paused, camera off");
// a real mouse drag: dozens of seeks a few milliseconds apart
await scrub(60, 8, 40); await after("fast drag (40 steps, 8 ms) while paused");
await H.evaluate(() => document.getElementById("v").play()); await sleep(3000);
await scrub(15, 8, 40); await after("fast drag (40 steps, 8 ms) while playing");
await H.evaluate(() => document.getElementById("v").pause()); await sleep(2000);
// a congested host: 700 ms latency and 4 Mbps down while it plays and drags; the viewer must not run ahead
await throttleHost(true); await H.evaluate(() => document.getElementById("v").play()); await sleep(5000); await after("playing, host on a slow link");
// forced host stall: a very slow link and a seek into unbuffered film; the viewer must never get ahead of the host's frozen picture
// seek far ahead (outside the 30 s buffer) and cut the host's network for 6 s: a guaranteed stall, then 250 kbps
await H.evaluate(() => { const v = document.getElementById("v"); v.currentTime = Math.min(v.duration - 8, v.currentTime + 35); });
await hostCdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
setTimeout(() => hostCdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 250e3 / 8, uploadThroughput: 1e6 / 8 }), 6000);
{ const rows = []; let maxAhead = -99, buffering = false; for (let i = 0; i < 24; i++) { await sleep(500); const [h, v] = await snap(); const st = await V.evaluate(() => document.getElementById("st").textContent); if (st === "host buffering" || st === "host offline") buffering = true; const d = v.t - h.t; if (!h.paused && h.rs < 3 || st.startsWith("host ")) maxAhead = Math.max(maxAhead, d); rows.push(`${fmt(d)}${h.rs < 3 ? "*" : ""}`); }
  console.log("host stall (slow link + seek), viewer-host every 0.5 s (* = host buffering):", rows.join(" "), `| most ahead during stall ${maxAhead > -99 ? fmt(maxAhead) : "n/a"} | viewer showed "host buffering/offline": ${buffering}`); }
await throttleHost(true); await sleep(3000);
await scrub(50); await after("scrub while playing, host on a slow link"); await throttleHost(false); await sleep(2000);
await H.evaluate(() => document.getElementById("v").play()); await sleep(3000);
await H.click("#bCam"); console.log("viewer receives host mic:", await waitLog(V, /receiving mic \(audio\)/, 30000)); await sleep(8000);
// the host's room socket drops for a moment: the camera must stay on the viewer and the host must re-announce it
{ const before = await V.evaluate(() => getComputedStyle(document.getElementById("cam")).display); await H.evaluate(() => window.__closeWs()); await sleep(6000);
  const after6 = await V.evaluate(() => ({ cam: getComputedStyle(document.getElementById("cam")).display, w: document.getElementById("cam").videoWidth, badge: document.getElementById("bLive").textContent }));
  const hlog = (await logOf(H)).split("\n").filter(l => /re-announced|room connected|room closed/.test(l)).slice(-3).join(" | ");
  console.log(`host socket dropped with camera on: viewer tile before ${before}, 6 s later ${after6.cam} (${after6.w}px wide) badge ${after6.badge} | host: ${hlog}`); }
await scrub(45); await after("scrub while playing, camera on");
await H.evaluate(() => document.getElementById("v").pause()); await sleep(2000);
await scrub(25); await after("scrub while paused, camera on");
// host reload while playing
await H.evaluate(() => document.getElementById("v").play()); await sleep(3000);
const beforeReload = await snap(); await H.reload(); await sleep(1000);
const [v1] = await Promise.all([V.evaluate(() => { const v = document.getElementById("v"); return { t: v.currentTime, paused: v.paused }; })]);
await sleep(4000);
const v5 = await V.evaluate(() => { const v = document.getElementById("v"); return { t: v.currentTime, paused: v.paused, clk: document.getElementById("clk").textContent, live: document.getElementById("bLive").textContent }; });
await waitLog(H, /film loaded/, 30000); await sleep(1500);
const h = await H.evaluate(() => { const v = document.getElementById("v"); return { t: v.currentTime, paused: v.paused }; });
console.log(`host reload: host was at ${beforeReload[0].t.toFixed(1)} s playing | viewer 1 s later: ${v1.t.toFixed(1)} s paused=${v1.paused} | 5 s later: ${v5.t.toFixed(1)} s paused=${v5.paused} clock "${v5.clk}" badge ${v5.live} | host page back: ${h.t.toFixed(1)} s paused=${h.paused}`);
await H.evaluate(() => document.getElementById("v").play()); await after("host presses play after the reload");
console.log("viewer log tail:", (await logOf(V)).split("\n").filter(l => /resync|voice|host|room/.test(l)).slice(-6).join(" | "));
// the viewer's connection drops mid-film: good link -> 1 Mbps -> 400 kbps; count stall time and watch the quality it plays
{ const viewerCdp = await V.context().newCDPSession(V); await viewerCdp.send("Network.enable");
  const probe = () => V.evaluate(() => { const v = document.getElementById("v"); return { t: v.currentTime, rs: v.readyState, st: document.getElementById("st").textContent, res: document.getElementById("res").textContent }; });
  await H.evaluate(() => { const v = document.getElementById("v"); v.currentTime = 5; return v.play(); }); await sleep(8000);
  const start = await probe(); console.log(`viewer link test: starts at ${start.res}`); const logMark = (await logOf(V)).length;
  let stalled = 0, samples = []; const run = async (label, ms) => { let last = (await probe()).t, lastRes = ""; for (let i = 0; i < ms / 500; i++) { await sleep(500); const p = await probe(); if (p.t === last && !p.st.startsWith("host")) stalled += 0.5; last = p.t; if (p.res !== lastRes) { samples.push(`${label}@${(i / 2).toFixed(0)}s ${p.res}`); lastRes = p.res; } } };
  await viewerCdp.send("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: 1e6 / 8, uploadThroughput: 1e6 / 8 }); await run("1Mbps", 25000);
  await viewerCdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 400e3 / 8, uploadThroughput: 500e3 / 8 }); await run("400k", 25000);
  const [h, v] = await snap(); console.log(`viewer link 1 Mbps then 400 kbps for 25 s each: viewer stalled ${stalled.toFixed(1)} s in total | quality seen: ${samples.join(", ")} | viewer-host at the end ${fmt(v.t - h.t)} (viewer ${v.paused ? "paused" : "playing"})`);
  console.log("  viewer log during the link test:\n   " + (await logOf(V)).slice(logMark).split("\n").filter(l => /stall guard|resync|follow|seeked|link|quality|layer/.test(l)).join("\n   "));
  await viewerCdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await sleep(3000); }
// a viewer whose room socket drops must not play on; it resumes when the link is back
await V.evaluate(() => window.__closeWs()); await sleep(250); const down = await V.evaluate(() => ({ paused: document.getElementById("v").paused, st: document.getElementById("st").textContent }));
await sleep(4000); const back = await (async () => { const [h, v] = await snap(); return { paused: v.paused, d: fmt(v.t - h.t) }; })();
console.log(`viewer socket dropped while playing: 0.25 s later paused=${down.paused} status "${down.st}" | 5.5 s later paused=${back.paused} viewer-host ${back.d}`);
// socket dropped and the party ends before it is back
await V.evaluate(() => window.__closeWs()); import("node:fs").then(fs => { fs.mkdirSync(new URL("./out", import.meta.url).pathname, { recursive: true }); }); 
H.on("dialog", d => d.accept()); const [hBefore] = await snap(); await H.click("#bEnd", { timeout: 15000 }).catch(() => {}); await sleep(1500);
const ended = await V.evaluate(() => { const v = document.getElementById("v"); const o = document.getElementById("over"); return { t: v.currentTime.toFixed(1), paused: v.paused, badge: document.getElementById("bLive").textContent, clk: document.getElementById("clk").textContent, screen: getComputedStyle(o).display === "flex" ? `"${o.textContent}" shown, video ${v.videoWidth ? "still has a frame" : "blank"}` : "overlay NOT shown" }; });
await sleep(6000); const ended2 = await V.evaluate(() => ({ t: document.getElementById("v").currentTime.toFixed(1), paused: document.getElementById("v").paused }));
console.log(`host ends party at ${hBefore.t.toFixed(1)} s (host ${hBefore.paused ? "paused" : "playing"}) | viewer 1.5 s later: ${ended.t} s paused=${ended.paused} badge ${ended.badge} clock "${ended.clk}" screen ${ended.screen} | 7.5 s later: ${ended2.t} s paused=${ended2.paused}`);
{ const fs = await import("node:fs"); const out = new URL("./out", import.meta.url).pathname; fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(`${out}/viewer-log.txt`, await logOf(V)); fs.writeFileSync(`${out}/host-log.txt`, await logOf(H)); console.log("logs saved to scripts/tests/out/"); }
await browser.close();
execSync(`npx wrangler d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scrub-%@example.com'); DELETE FROM party_tickets WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scrub-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scrub-%@example.com'); UPDATE parties SET status='ended' WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'scrub-%@example.com') AND status!='ended'; DELETE FROM users WHERE email LIKE 'scrub-%@example.com'"`, { cwd: ROOT, stdio: "ignore" });
