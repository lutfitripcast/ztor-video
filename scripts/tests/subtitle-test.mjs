// Subtitles on the Watch page (protected-URL version): the selector lists the film's tracks, a choice shows cues that follow
// the playback position, and the choice is remembered. Needs Chrome + wrangler. BASE_URL, FILM, HOST_RULES, WRANGLER_PROFILE.
import { chromium } from "playwright"; import { execSync } from "node:child_process";
const ROOT = new URL("../..", import.meta.url).pathname;
const B = process.env.BASE_URL ?? "https://ztor-video.eric-tam.workers.dev", FILM = process.env.FILM;
const PROFILE = process.env.WRANGLER_PROFILE ? { XDG_CONFIG_HOME: process.env.WRANGLER_PROFILE } : {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const tag = Date.now().toString(36);
const args = ["--autoplay-policy=no-user-gesture-required"]; if (process.env.HOST_RULES) args.push(`--host-resolver-rules=${process.env.HOST_RULES}`);
const browser = await chromium.launch({ channel: "chrome", headless: true, args }); const page = await (await browser.newContext()).newPage();
await page.goto(`${B}/app`); await page.waitForSelector("#tUp"); await page.click("#tUp"); await page.fill("#uName", "Subs " + tag); await page.fill("#uEmail", `subs-${tag}@example.com`); await page.fill("#uPass", "password123"); await page.click("#bUp"); await page.waitForSelector("#navUser .role", { timeout: 20000 });
await page.evaluate(async (id) => (await fetch(`/api/rent/${id}`, { method: "POST" })).status, FILM);
await page.goto(`${B}/app#/watch/${FILM}`); await page.waitForSelector("#bPlay", { timeout: 15000 }); await page.selectOption("#mode", "url"); await page.click("#bPlay");
await page.waitForFunction(() => document.getElementById("st").textContent === "playing", null, { timeout: 40000 }); await sleep(1500);
const opts = await page.evaluate(() => [...document.querySelectorAll("#subs option")].map(o => `${o.value}=${o.textContent}`)); console.log("selector options:", opts.join(", "));
const cueAt = async (lang, t) => { await page.selectOption("#subs", lang); await page.evaluate((t) => { document.getElementById("v").currentTime = t; }, t); await sleep(2500); return page.evaluate(() => { const v = document.getElementById("v"); const out = []; for (const tr of v.textTracks) if (tr.mode === "showing") for (const c of tr.activeCues || []) out.push(`${tr.language}: "${c.text}"`); return { t: v.currentTime.toFixed(1), shown: out, playing: !v.paused }; }); };
console.log("zh-hk at 1:19 ->", JSON.stringify(await cueAt("zh-hk", 79.5)));
console.log("en-us at 1:24 ->", JSON.stringify(await cueAt("en-us", 84.8)));
console.log("off at 1:24   ->", JSON.stringify(await cueAt("off", 84.8)));
await page.selectOption("#subs", "en-us"); await page.reload(); await page.waitForSelector("#bPlay", { timeout: 15000 }); await page.selectOption("#mode", "url"); await page.click("#bPlay"); await page.waitForFunction(() => document.getElementById("st").textContent === "playing", null, { timeout: 40000 }); await sleep(1500);
console.log("remembered after reload:", await page.evaluate(() => document.getElementById("subs").value));
console.log("log:", (await page.evaluate(() => document.getElementById("log").textContent)).split("\n").filter(l => /subtitle/.test(l)).slice(-4).join(" | "));
await browser.close();
execSync(`npx wrangler d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'subs-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'subs-%@example.com'); DELETE FROM users WHERE email LIKE 'subs-%@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
