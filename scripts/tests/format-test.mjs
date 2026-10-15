// Plays every ready film on the Watch page in the real Chrome (with Widevine), DRM version and protected-URL version, and reports the format,
// key system, resolution and license count. Needs Chrome + wrangler. BASE_URL picks the Worker; HOST_RULES passes Chrome
// --host-resolver-rules (for networks whose DNS hijacks workers.dev, e.g. "MAP ztor-video.eric-tam.workers.dev 104.21.25.123").
import { chromium } from "playwright";
import { execSync } from "node:child_process";
const ROOT = new URL("../..", import.meta.url).pathname;
const B = process.env.BASE_URL ?? "https://ztor-video.mluthfi840.workers.dev";
const PROFILE = process.env.WRANGLER_PROFILE ? { XDG_CONFIG_HOME: process.env.WRANGLER_PROFILE } : {};
const CFG = process.env.WRANGLER_CONFIG ? ` -c ${process.env.WRANGLER_CONFIG}` : "";   // e.g. wrangler.account1.jsonc for the first account
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tag = Date.now().toString(36);
// DRM needs Chrome's Widevine module, which Playwright's own launch does not load: launch the real Chrome headless on a
// debugging port and connect to it. CDP_PORT picks the port (default 9333).
import { spawn } from "node:child_process";
const port = Number(process.env.CDP_PORT || 9333), profile = `/tmp/cdp-profile-${port}`;
const args = [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required"];
if (process.env.HOST_RULES) args.push(`--host-resolver-rules=${process.env.HOST_RULES}`);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [...args, "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await (await fetch(`http://localhost:${port}/json/version`)).json(); break; } catch { await sleep(500); } }
const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const page = await browser.contexts()[0].newPage();
await page.goto(`${B}/app`); await page.waitForSelector("#tUp"); await page.click("#tUp"); await page.fill("#uName", "Format " + tag); await page.fill("#uEmail", `format-${tag}@example.com`); await page.fill("#uPass", "password123"); await page.click("#bUp"); await page.waitForSelector("#navUser .role", { timeout: 20000 });
const films = await page.evaluate(async () => (await (await fetch("/api/films")).json()));   // the app lists ready films only
for (const f of films) {
  await page.evaluate(async (id) => (await fetch(`/api/rent/${id}`, { method: "POST" })).status, f.id);
  for (const mode of ["drm", ...(f.protections.includes("url") ? ["url"] : [])]) {
    await page.goto(`${B}/app#/watch/${f.id}`); await page.waitForSelector("#bPlay", { timeout: 15000 });
    await page.selectOption("#mode", mode); await page.click("#bPlay");
    const t0 = Date.now(); let st = "";
    while (Date.now() - t0 < 40000) { st = await page.evaluate(() => document.getElementById("st").textContent); if (st === "playing" || st === "error") break; await sleep(500); }
    await sleep(6000);
    const r = await page.evaluate(() => { const v = document.getElementById("v"); const log = document.getElementById("log").textContent; return { st: document.getElementById("st").textContent, res: document.getElementById("res").textContent, lic: document.getElementById("lic").textContent, t: v.currentTime.toFixed(1), key: (log.match(/key system: [^\n]*|protection: [^\n]*/) || [""])[0], err: (log.match(/shaka error[^\n]*/) || [""])[0] }; });
    console.log(`${f.title.slice(0, 30).padEnd(30)} ${mode.padEnd(4)} ${r.st.padEnd(8)} at ${r.t} s  ${r.res.padEnd(22)} licenses ${r.lic}  | ${r.key}${r.err ? "  !! " + r.err : ""}`);
    if (r.st !== "playing") console.log("   log tail: " + (await page.evaluate(() => document.getElementById("log").textContent.trim().split("\n").slice(-6).join(" | "))).slice(0, 900));
    await page.click("#bStop");
  }
}
await browser.close(); chrome.kill();
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'format-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'format-%@example.com'); DELETE FROM users WHERE email LIKE 'format-%@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
