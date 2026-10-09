import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = new URL("./out", import.meta.url).pathname; mkdirSync(OUT, { recursive: true });   // screenshots, ignored by git
const ROOT = new URL("../..", import.meta.url).pathname;   // repo root, for wrangler commands
import { execSync } from "node:child_process";
const B = process.env.BASE_URL ?? "https://ztor-video.mluthfi840.workers.dev";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = (k, v) => console.log(k.padEnd(40), typeof v === "string" ? v : JSON.stringify(v));
const tag = Date.now().toString(36);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const errs = [];
const page = async () => { const c = await browser.newContext({ permissions: ["camera", "microphone"] }); const p = await c.newPage(); p.on("pageerror", e => errs.push(e.message)); return p; };
const logOf = (p) => p.evaluate(() => (document.getElementById("log")?.textContent) || "");
const waitLog = async (p, re, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await logOf(p))) return true; await sleep(300); } return false; };
const register = async (p, name, email, pass) => { await p.goto(`${B}/app`); await p.waitForSelector("#tUp"); await p.click("#tUp"); await p.fill("#uName", name); await p.fill("#uEmail", email); await p.fill("#uPass", pass); await p.click("#bUp"); await p.waitForSelector("#navUser .role", { timeout: 15000 }); return p.evaluate(() => document.querySelector("#navUser .role").textContent); };

// admin = whoever is first in this database; we can't know, so read /api/admin/users through A after registering
const A = await page(); out("A registers as", await register(A, "Alice " + tag, `alice-${tag}@example.com`, "password123"));
const Bp = await page(); out("B registers as", await register(Bp, "Bob " + tag, `bob-${tag}@example.com`, "password123"));
const C = await page(); out("C registers as", await register(C, "Cara " + tag, `cara-${tag}@example.com`, "password123"));
// wrong password + duplicate email
out("wrong password (401)", await A.evaluate(async () => (await fetch("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@example.com", password: "nope" }) })).status));
out("duplicate email (409)", await A.evaluate(async (e) => (await fetch("/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Dup", email: e, password: "password123" }) })).status, `bob-${tag}@example.com`));
// B (user) cannot create a party, cannot see admin
const filmId = await Bp.evaluate(async () => (await (await fetch("/api/films")).json()).find(f => f.protections.includes("url"))?.id);
out("B create party as user (403)", await Bp.evaluate(async (f) => (await fetch("/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filmId: f }) })).status, filmId));
out("B admin users (403)", await Bp.evaluate(async () => (await fetch("/api/admin/users")).status));
// find an admin session: A if first account; otherwise log in as the existing admin is impossible -> use A if admin else skip
const aRole = await A.evaluate(() => document.querySelector("#navUser .role").textContent);
let adminPage = A;
if (aRole !== "admin") {
  out("note", "an admin already exists; promoting Bob to host directly in D1 for this run");
  execSync(`npx wrangler d1 execute ztor-video --remote --command "UPDATE users SET role='host' WHERE email='bob-${tag}@example.com'"`, { cwd: ROOT, stdio: "ignore" });
}
if (aRole === "admin") {
  await A.goto(`${B}/app#/admin`); await A.waitForSelector("#rows select");
  const bobId = await A.evaluate((e) => [...document.querySelectorAll("#rows tr")].find(tr => tr.textContent.includes(e))?.querySelector("select").dataset.id, `bob-${tag}@example.com`);
  await A.selectOption(`#rows select[data-id="${bobId}"]`, "host"); await sleep(1000);
  out("admin sets Bob -> host", await A.evaluate(async (id) => (await (await fetch("/api/admin/users")).json()).find(u => u.id === id)?.role, bobId));
  out("admin demote self last admin (409)", await A.evaluate(async () => { const meId = (await (await fetch("/auth/me")).json()).user.id; return (await fetch(`/api/admin/users/${meId}/role`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "user" }) })).status; }));
}
// Bob (now host) hosts a party from the UI
await Bp.reload(); await Bp.waitForSelector("#bHost", { timeout: 15000 }); await Bp.click("#bHost"); await Bp.waitForSelector("#hGo"); await Bp.fill("#hTitle", "Bob's premiere " + tag); await Bp.click("#hGo");
out("Bob in party as host", await waitLog(Bp, /joined .* as host/, 20000));
await sleep(1500); await Bp.click("#bCam"); const pub = await waitLog(Bp, /published cam, mic/, 30000); out("Bob camera published", pub); if (!pub) console.log("BOB LOG:\n" + await logOf(Bp));
const partyHash = await Bp.evaluate(() => location.hash);
// Cara (user) joins: needs rental -> rent-and-join screen
await C.goto(`${B}/app${partyHash}`); await C.waitForSelector("#bTicketJoin", { timeout: 15000 }); out("Cara sees get-a-ticket", true); await C.click("#bTicketJoin");
out("Cara joined as viewer", await waitLog(C, /joined .* as viewer/, 20000));
out("Cara /play film outside party (402)", await C.evaluate(async (f) => (await fetch(`/play/${f}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: "x", mode: "url" }) })).status, filmId));
out("Cara join a party that does not exist (404)", await C.evaluate(async () => { const r = await fetch("/party", { method: "POST" }); return (await fetch(`/party/nope-party/join`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status; }));
out("Cara receives Bob's camera", await waitLog(C, /receiving cam \(video\)/, 30000));
await C.click("#bGate");
await C.fill("#text", "hello from Cara"); await C.click("#bSend"); await sleep(1000);
out("Bob sees chat with display name", await Bp.evaluate(() => [...document.querySelectorAll("#msgs .m")].map(m => m.textContent.replace(/pinmuteremove$/, "")).slice(-1)));
await Bp.hover("#msgs .m:last-child"); await Bp.click("#msgs .m:last-child button[data-a=pin]"); await sleep(800);
out("Cara sees pin", await C.evaluate(() => document.getElementById("pinned").textContent));
await Bp.evaluate(() => { const v = document.getElementById("v"); v.currentTime = 4; return v.play(); }); await sleep(6000);
out("Cara sync", await C.evaluate(() => ({ sync: document.getElementById("sync").textContent, clk: document.getElementById("clk").textContent, live: document.getElementById("bLive").textContent, viewers: document.getElementById("viewers").textContent })));
// home shows the party live
await A.goto(`${B}/app#/home`); await sleep(2500);
out("home Live now card", await A.evaluate(() => [...document.querySelectorAll(".party")].map(p => p.textContent.replace(/\s+/g, " ").trim().slice(0, 90))));
// Cara leaves via Home: cleanup runs; Bob ends the party
await C.evaluate(() => location.hash = "#/home"); await sleep(1500);
Bp.once("dialog", d => d.accept()); await Bp.click("#bEnd"); await sleep(2000);
out("party ended -> Bob back home", await Bp.evaluate(() => location.hash));
await A.screenshot({ path: `${OUT}/app-home.png`, fullPage: true }); await Bp.screenshot({ path: `${OUT}/app-host.png` });
out("page errors", errs);
await browser.close();
