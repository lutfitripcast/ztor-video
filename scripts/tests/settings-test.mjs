// Settings menu (2026-10-19, parity with the Ztor watch party): every person picks their own subtitles (+ size), audio and
// quality from a gear on the picture, in the party and on the Watch page. Host and viewer choose independently.
// LOCAL_APP=1 serves this checkout's public/app.html in place of the deployed page, so the change is tested before deploy.
import { chromium } from "playwright"; import { execSync } from "node:child_process"; import { readFileSync } from "node:fs";
const ROOT = new URL("../..", import.meta.url).pathname;
const B = process.env.BASE_URL ?? "https://ztor-video.eric-tam.workers.dev", FILM = process.env.FILM, CFG = process.env.WRANGLER_CONFIG ? ` -c ${process.env.WRANGLER_CONFIG}` : "";
const PROFILE = process.env.WRANGLER_PROFILE ? { XDG_CONFIG_HOME: process.env.WRANGLER_PROFILE } : {};
const LOCAL = process.env.LOCAL_APP === "1" ? readFileSync(new URL("../../public/app.html", import.meta.url), "utf8") : null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const tag = Date.now().toString(36);
const results = []; const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]; if (process.env.HOST_RULES) args.push(`--host-resolver-rules=${process.env.HOST_RULES}`);
const browser = await chromium.launch({ channel: "chrome", headless: true, args });
const page = async (viewport = { width: 1280, height: 860 }) => { const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport }); if (LOCAL) await ctx.route(`${B}/app`, r => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: LOCAL })); return ctx.newPage(); };
const register = async (p, name, email) => { await p.goto(`${B}/app`); await p.waitForSelector("#tUp"); await p.click("#tUp"); await p.fill("#uName", name); await p.fill("#uEmail", email); await p.fill("#uPass", "password123"); await p.click("#bUp"); await p.waitForSelector("#navUser .role", { timeout: 20000 }); };
const logOf = (p) => p.evaluate(() => document.getElementById("log")?.textContent || "");
const waitLog = async (p, re, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await logOf(p))) return true; await sleep(300); } return false; };
const rows = (p) => p.evaluate(() => [...document.querySelectorAll(".setpanel [data-setrow]")].map(b => `${b.dataset.setrow}=${b.querySelector(".val").textContent}`));
const openMenu = async (p) => { await p.click(".setbtn"); await sleep(200); };
const pickIn = async (p, row, text) => { await openMenu(p); await p.click(`.setpanel [data-setrow="${row}"]`); await p.locator(".setpanel .setopt", { hasText: text }).first().click(); await sleep(400); await p.keyboard.press("Escape").catch(() => {}); await p.mouse.click(5, 5); };
const sel = (p, id) => p.evaluate((i) => document.getElementById(i).value, id);
try {
  const H = await page(); await register(H, "Set Host " + tag, `pset-host-${tag}@example.com`);
  execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "UPDATE users SET role='host' WHERE email='pset-host-${tag}@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
  const V = await page(); await register(V, "Set Viewer " + tag, `pset-view-${tag}@example.com`);
  await H.reload(); await H.waitForSelector("#bHost", { timeout: 20000 }); await H.click("#bHost"); await H.waitForSelector("#hGo"); if (FILM) await H.selectOption("#hFilm", FILM); const filmId = await H.evaluate(() => document.getElementById("hFilm").value); await H.fill("#hTitle", "Settings " + tag); await H.click("#hGo");
  if (!await waitLog(H, /joined .* as host/)) throw new Error("host did not join");
  const hash = await H.evaluate(() => location.hash);
  await V.goto(`${B}/app${hash}`); await V.waitForSelector("#bTicketJoin", { timeout: 20000 }); await V.click("#bTicketJoin");
  if (!await waitLog(V, /joined .* as viewer/)) throw new Error("viewer did not join");
  await waitLog(H, /film loaded/); await waitLog(V, /film loaded/); await V.click("#bGate"); await sleep(2500);

  check("host has the Settings gear", await H.locator(".setbtn").count() === 1);
  check("viewer has the Settings gear", await V.locator(".setbtn").count() === 1);
  await openMenu(H); const hr = await rows(H); await H.mouse.click(5, 5);
  await openMenu(V); const vr = await rows(V); await V.mouse.click(5, 5);
  const needSubs = process.env.NO_SUBS !== "1";
  check("host menu rows", (!needSubs || hr.some(r => r.startsWith("subs="))) && hr.some(r => r.startsWith("q=")), hr.join(", "));
  check("viewer menu rows (the viewer had no subtitle, audio or quality choice before)", (!needSubs || vr.some(r => r.startsWith("subs="))) && vr.some(r => r.startsWith("q=")), vr.join(", "));

  const langs = await V.evaluate(() => [...document.getElementById("subs").options].map(o => o.textContent).filter(t => t !== "off"));
  if (langs.length >= 2) {
    await pickIn(H, "subs", langs[0]); await pickIn(V, "subs", langs[1]); await sleep(2500);
    const [hs, vs] = [await sel(H, "subs"), await sel(V, "subs")];
    check("host and viewer keep different subtitle languages", hs !== vs && hs !== "off" && vs !== "off", `host ${hs}, viewer ${vs}`);
  } else if (process.env.NO_SUBS === "1") console.log("film has no subtitles (NO_SUBS=1), subtitle checks skipped");
  else check("film has two subtitle languages to compare", false, langs.join(", "));

  if (langs.length) {
    await openMenu(V); await V.click('.setpanel [data-setrow="subs"]'); await V.click('.setsize button[data-size="lg"]'); await V.mouse.click(5, 5);
    const scale = await V.evaluate(() => getComputedStyle(document.getElementById("caps")).getPropertyValue("--cc-scale").trim());
    check("subtitle size Large sets the caption scale", scale === "1.3", `--cc-scale ${scale}`);
    check("subtitle size is remembered", await V.evaluate(() => localStorage.getItem("ztor.ccsize")) === "lg");
  }

  const rungs = await V.evaluate(() => [...document.getElementById("q").options].map(o => o.value).filter(v => v !== "auto"));
  const low = rungs[rungs.length - 1];
  if (low) {
    await pickIn(V, "q", `${low}p`); await sleep(8000);
    const st = await V.evaluate(() => { const p = window.__player(); const t = p.getVariantTracks().find(t => t.active); return { abr: p.getConfiguration().abr.enabled, h: t?.height }; });
    const hq = await sel(H, "q");
    check("viewer fixes a rung: automatic switching off, that rung active, host untouched", st.abr === false && String(st.h) === low && hq === "auto", `viewer abr ${st.abr} ${st.h}p, host ${hq}`);
  }
  const ar = await V.evaluate(() => !document.querySelector('#aud')?.closest('[data-audio]')?.hidden);
  if (ar) {
    const tracks = await V.evaluate(() => [...document.getElementById("aud").options].map(o => o.textContent));
    await pickIn(H, "aud", tracks[0]); await pickIn(V, "aud", tracks[1]); await sleep(2500);
    const lang = (p) => p.evaluate(() => window.__player().getVariantTracks().find(t => t.active)?.language);
    const [ha, va] = [await sel(H, "aud"), await sel(V, "aud")];
    check("host and viewer keep different audio languages", ha !== va, `host ${ha} (playing ${await lang(H)}), viewer ${va} (playing ${await lang(V)})`);
  } else console.log("audio row hidden (film has one audio track)");

  // phone: bottom sheet
  await V.setViewportSize({ width: 390, height: 844 }); await sleep(500); await openMenu(V);
  const sheet = await V.evaluate(() => { const r = document.querySelector(".setpanel").getBoundingClientRect(); return { pos: getComputedStyle(document.querySelector(".setpanel")).position, w: Math.round(r.width), bottom: Math.round(innerHeight - r.bottom) }; });
  check("phone: bottom sheet", sheet.pos === "fixed" && sheet.w === 390 && sheet.bottom === 0, JSON.stringify(sheet));
  await V.mouse.click(5, 5);
  await V.setViewportSize({ width: 844, height: 390 }); await sleep(500); await openMenu(V);
  const side = await V.evaluate(() => { const r = document.querySelector(".setpanel").getBoundingClientRect(); return { w: Math.round(r.width), right: Math.round(innerWidth - r.right), h: Math.round(r.height) }; });
  check("landscape: right side panel", side.w === 360 && side.right === 0 && side.h === 390, JSON.stringify(side));
  await V.screenshot({ path: `/tmp/settings-landscape-${tag}.png` });
  H.on("dialog", d => d.accept()); await H.click("#bEnd").catch(() => {}); await sleep(800);

  // Watch page (the host rented the film when creating the party): the same menu replaces the three selectors.
  // Ending the party sends the host home; let that settle, then open the film (the route renders twice on arrival).
  await sleep(2500); await H.goto(`${B}/app#/watch/${filmId}`); await sleep(2500); await H.waitForSelector("#bPlay", { timeout: 20000 }); await H.selectOption("#mode", "url"); await H.click("#bPlay");
  await waitLog(H, /loaded:/, 40000); await sleep(1500);
  check("Watch page: old selectors are out of the status row", await H.evaluate(() => [...document.querySelectorAll("#q,#subs,#aud")].every(e => !e.offsetParent)));
  await openMenu(H); const wr = await rows(H); await H.mouse.click(5, 5);
  check("Watch page: Settings menu lists the film's choices", wr.some(r => r.startsWith("q=")), wr.join(", "));
} catch (e) { check("run completed", false, e.message); }
finally {
  await browser.close();
  execSync(`npx wrangler${CFG} d1 execute ztor-video --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pset-%@example.com'); DELETE FROM party_tickets WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pset-%@example.com'); DELETE FROM rentals WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pset-%@example.com'); UPDATE parties SET status='ended' WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'pset-%@example.com') AND status!='ended'; DELETE FROM users WHERE email LIKE 'pset-%@example.com'"`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...PROFILE } });
  console.log(`${results.filter(r => r.ok).length}/${results.length} passed`);
}
