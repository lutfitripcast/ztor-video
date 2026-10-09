import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = new URL("./out", import.meta.url).pathname; mkdirSync(OUT, { recursive: true });   // screenshots, ignored by git
const B = process.env.BASE_URL ?? "https://ztor-video.mluthfi840.workers.dev", FILM = process.env.FILM ?? "439662d9-e97b-44f5-9ae1-7bd346553e4b";
const j = async (m, p, body, h = {}) => { const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", ...h }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const c = await j("POST", "/party", { hostId: "host-1", filmId: FILM, title: "security checks" }); const id = c.b.partyId; console.log("party", id);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext(); const bad = [];
const host = await ctx.newPage(); host.on("response", r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(B, "")}`); });
await host.goto(`${B}/watch?party=${id}&user=host-1`);
const logOf = () => host.evaluate(() => document.getElementById("log").textContent);
for (let i = 0; i < 40 && !/room connected/.test(await logOf()); i++) await sleep(300);
await host.click("#bChecks");
for (let i = 0; i < 60; i++) { const t = await host.evaluate(() => [...document.querySelectorAll("#checksCard .checks div")].map(d => d.lastElementChild.textContent)); if (t.every(x => x !== "…")) break; await sleep(500); }
const rows = await host.evaluate(() => [...document.querySelectorAll("#checksCard .checks div")].map(d => `${d.firstElementChild.textContent}  =>  ${d.lastElementChild.textContent}`));
rows.forEach(r => console.log(r));
console.log("---- 4xx during checks ----\n" + (bad.join("\n") || "none"));
await host.screenshot({ path: `${OUT}/checks.png`, fullPage: true });
await j("POST", `/party/${id}/end`, {}, { authorization: "Bearer " + (await host.evaluate(() => me.token)) });
await browser.close();
