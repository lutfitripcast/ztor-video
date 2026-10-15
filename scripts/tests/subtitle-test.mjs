// Subtitles on the Watch page (protected-URL version): the selector lists the film's tracks, a choice shows cues that follow
// the playback position, and the choice is remembered. Needs Chrome + wrangler. BASE_URL, FILM, HOST_RULES, WRANGLER_PROFILE.
import { chromium } from "playwright"; import { execSync } from "node:child_process";
const ROOT = new URL("../..", import.meta.url).pathname;
const B = process.env.BASE_URL ?? "https://ztor-video.eric-tam.workers.dev", FILM = process.env.FILM;
const PROFILE = process.env.WRANGLER_PROFILE ? { XDG_CONFIG_HOME: process.env.WRANGLER_PROFILE } : {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const tag = Date.now().toString(36);
const MODE = process.env.MODE || "url";   // url | drm (drm needs the real Chrome with Widevine: CDP=1)
import { spawn } from "node:child_process";
const args = ["--autoplay-policy=no-user-gesture-required"]; if (process.env.HOST_RULES) args.push(`--host-resolver-rules=${process.env.HOST_RULES}`);
let browser, page, chrome = null;
if (process.env.CDP) { const port = Number(process.env.CDP_PORT || 9337); chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/cdp-profile-${port}`, "--no-first-run", ...args, "about:blank"], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await (await fetch(`http://localhost:${port}/json/version`)).json(); break; } catch { await sleep(500); } } browser = await chromium.connectOverCDP(`http://localhost:${port}`); page = await browser.contexts()[0].newPage(); }
else { browser = await chromium.launch({ channel: "chrome", headless: true, args }); page = await (await browser.newContext()).newPage(); }
await page.goto(`${B}/app`); await page.waitForSelector("#tUp"); await page.click("#tUp"); await page.fill("#uName", "Subs " + tag); await page.fill("#uEmail", `subs-${tag}@example.com`); await page.fill("#uPass", "password123"); await page.click("#bUp"); await page.waitForSelector("#navUser .role", { timeout: 20000 });
await page.evaluate(async (id) => (await fetch(`/api/rent/${id}`, { method: "POST" })).status, FILM);
await page.goto(`${B}/app#/watch/${FILM}`); await page.waitForSelector("#bPlay", { timeout: 15000 }); await page.selectOption("#mode", MODE); await page.click("#bPlay");
await page.waitForFunction(() => document.getElementById("st").textContent === "playing", null, { timeout: 40000 }); await sleep(1500);
const opts = await page.evaluate(() => [...document.querySelectorAll("#subs option")].map(o => `${o.value}=${o.textContent}`)); console.log("selector options:", opts.join(", "));
const cueAt = async (lang, t) => {
  await page.selectOption("#subs", lang); await page.evaluate((t) => { document.getElementById("v").currentTime = t; }, t);
  const seen = new Set(); let now = t;
  for (let i = 0; i < 100; i++) {   // wait for playback to resume after the seek, then watch about 3 s of film for cues
    await sleep(200);
    const r = await page.evaluate(() => { const v = document.getElementById("v"); const out = []; const caps = document.querySelector("#caps"); if (caps && caps.textContent.trim()) out.push(caps.textContent.trim()); for (const tr of v.textTracks) if (tr.mode === "showing") for (const c of tr.activeCues || []) out.push(c.text); let ahead = 0; try { const b = v.buffered; if (b.length) ahead = b.end(b.length - 1) - v.currentTime; } catch {} return { t: v.currentTime, cues: out, paused: v.paused, rs: v.readyState, ahead: ahead.toFixed(1), st: document.getElementById("st").textContent }; });
    now = r.t; r.cues.forEach(c => seen.add(c)); if (i === 10 || i === 50) console.log(`   after ${i * 0.2} s: t=${now.toFixed(1)} paused=${r.paused} readyState=${r.rs} buffered ahead ${r.ahead} s status "${r.st}"`);
    if (now > t + 3) break;
  }
  return { seekedTo: t, endedAt: now.toFixed(1), cuesSeen: [...seen] };
};
console.log("zh-hk at 1:19 ->", JSON.stringify(await cueAt("zh-hk", 79.0)));
console.log("en-us at 1:24 ->", JSON.stringify(await cueAt("en-us", 84.2)));
console.log("off at 1:24   ->", JSON.stringify(await cueAt("off", 84.2)));
await page.selectOption("#subs", "en-us"); await page.reload(); await page.waitForSelector("#bPlay", { timeout: 15000 }); await page.selectOption("#mode", MODE); await page.click("#bPlay"); await page.waitForFunction(() => document.getElementById("st").textContent === "playing", null, { timeout: 40000 }); await sleep(1500);
console.log("remembered after reload:", await page.evaluate(() => document.getElementById("subs").value));
console.log("cues after reload, no toggle ->", JSON.stringify(await cueAt(await page.evaluate(() => document.getElementById("subs").value), 84.2)));
console.log("log:", (await page.evaluate(() => document.getElementById("log").textContent)).split("\n").filter(l => /subtitle/.test(l)).slice(-4).join(" | "));
await browser.close(); if (chrome) chrome.kill();
execSync(`npx wrangler d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'subs-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'subs-%@example.com'); DELETE FROM users WHERE email LIKE 'subs-%@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
