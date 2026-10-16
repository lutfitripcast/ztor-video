// Audio languages on the Watch page (protected-URL version): the selector lists the film's tracks, a choice switches Shaka's
// audio without a reload, and the choice is remembered and picked at the next load. Needs Chrome + wrangler.
// BASE_URL, FILM (a film encoded with more than one tagged audio track), HOST_RULES, WRANGLER_PROFILE, WRANGLER_CONFIG.
import { chromium } from "playwright"; import { execSync } from "node:child_process";
const ROOT = new URL("../..", import.meta.url).pathname;
const B = process.env.BASE_URL ?? "https://ztor-video.eric-tam.workers.dev", FILM = process.env.FILM, CFG = process.env.WRANGLER_CONFIG ? ` -c ${process.env.WRANGLER_CONFIG}` : "";
const PROFILE = process.env.WRANGLER_PROFILE ? { XDG_CONFIG_HOME: process.env.WRANGLER_PROFILE } : {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const tag = Date.now().toString(36);
const args = ["--autoplay-policy=no-user-gesture-required"]; if (process.env.HOST_RULES) args.push(`--host-resolver-rules=${process.env.HOST_RULES}`);
const browser = await chromium.launch({ channel: "chrome", headless: true, args }); const page = await (await browser.newContext()).newPage();
await page.goto(`${B}/app`); await page.waitForSelector("#tUp"); await page.click("#tUp"); await page.fill("#uName", "Audio " + tag); await page.fill("#uEmail", `audio-${tag}@example.com`); await page.fill("#uPass", "password123"); await page.click("#bUp"); await page.waitForSelector("#navUser .role", { timeout: 20000 });
await page.evaluate(async (id) => (await fetch(`/api/rent/${id}`, { method: "POST" })).status, FILM);
const play = async () => { await page.goto(`${B}/app#/watch/${FILM}`); await page.waitForSelector("#bPlay", { timeout: 15000 }); await page.selectOption("#mode", "url"); await page.click("#bPlay"); await page.waitForFunction(() => document.getElementById("st").textContent === "playing", null, { timeout: 40000 }); await sleep(1500); };
const state = () => page.evaluate(() => { const p = window.__player(); const a = p.getVariantTracks().find(t => t.active); const sel = document.getElementById("aud"); return { shown: !sel.closest("[data-audio]").hidden, options: [...sel.options].map(o => `${o.value}=${o.textContent}`).join(", "), value: sel.value, active: a ? a.language : null, languages: p.getAudioLanguages().join(","), t: document.getElementById("v").currentTime.toFixed(1), paused: document.getElementById("v").paused }; });
const activeIs = async (lang, ms = 8000) => { const t0 = Date.now(); let s; while (Date.now() - t0 < ms) { s = await state(); if (s.active === lang) return s; await sleep(300); } return s; };
await play();
let s = await state(); console.log(`selector shown: ${s.shown} | options: ${s.options} | selected: ${s.value} | Shaka languages: ${s.languages} | active at load: ${s.active}`);
const langs = (await state()).options.split(", ").map(o => o.split("=")[0]); const other = langs.find(l => l !== s.value);
await page.selectOption("#aud", other); s = await activeIs(other); console.log(`switched to ${other}: active ${s.active} at ${s.t} s, paused ${s.paused}`);
await page.selectOption("#aud", langs[0]); s = await activeIs(langs[0]); console.log(`back to ${langs[0]}: active ${s.active} at ${s.t} s, paused ${s.paused}`);
await page.selectOption("#aud", other); await activeIs(other); await play(); s = await state(); console.log(`after reload: selected ${s.value}, active at load ${s.active} (remembered ${other})`);
console.log("log:", (await page.evaluate(() => document.getElementById("log").textContent)).split("\n").filter(l => /audio/.test(l)).slice(-4).join(" | "));
await browser.close();
execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'audio-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'audio-%@example.com'); DELETE FROM users WHERE email LIKE 'audio-%@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
