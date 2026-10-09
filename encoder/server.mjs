// Proposal step 5: the video machine. Node, no dependencies.
//   POST /encode  { filmId, sourceUrl, keys, uploadEndpoint, doneEndpoint, runnerToken }   (Phase B: called by the Workflow)
//   POLL mode     env POLL_URL + RUNNER_TOKEN: asks GET {POLL_URL}/jobs/next every POLL_S seconds  (Phase A: runs on a laptop)
// The container has NO R2 binding. It reads the master from a presigned URL and uploads outputs to the Worker.
import http from "node:http";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = Number(process.env.PORT || 8080);
const RUNNER_NAME = process.env.RUNNER_NAME || os.hostname();
const WORK = process.env.WORK_DIR || "/tmp/ztor";

const sh = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  let out = "", errb = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (errb += d));
  p.on("close", (code) => code === 0 ? resolve({ out, err: errb, wall_s: (Date.now() - t0) / 1000 }) : reject(new Error(`${cmd} exited ${code}: ${errb.slice(-800)}`)));
});
const parseTime = (s) => Object.fromEntries([...s.matchAll(/(\w+)=([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(path.relative(base, p));
  }
  return out;
}

async function encodeJob(job) {
  const { filmId, sourceUrl, keys, uploadEndpoint, doneEndpoint, runnerToken } = job;   // job.protections: "drm" | "drm,url"
  const dir = path.join(WORK, filmId);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, "renditions"), { recursive: true });
  const steps = [];
  const log = (m) => console.log(`[${filmId.slice(0, 8)}] ${m}`);
  try {
    // 1. probe: read straight from the presigned URL, nothing lands on disk (20 GB container disk cannot hold a ProRes master)
    const probe = JSON.parse((await sh("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", sourceUrl])).out);
    const v = probe.streams.find((s) => s.codec_type === "video");
    const height = v.height, dur = Number(probe.format.duration);
    log(`source ${v.width}x${height} ${v.codec_name} ${dur.toFixed(1)}s`);

    // 2. encode the ladder, capped at the source height (no upscaling), one ffmpeg run, decode once
    const r = await sh("/usr/bin/time", ["-f", "wall_s=%e user_s=%U sys_s=%S maxrss_kb=%M", "-o", `${dir}/encode.time`,
      "/work/encode.sh", sourceUrl, `${dir}/renditions`, String(height)]);
    const et = parseTime(await fs.readFile(`${dir}/encode.time`, "utf8"));
    // guard: every rendition must be as long as the source (a dropped HTTP read makes ffmpeg stop early and exit 0)
    for (const f of (await fs.readdir(`${dir}/renditions`)).filter((f) => f.endsWith(".mp4"))) {
      const d = Number((await sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${dir}/renditions/${f}`])).out.trim());
      if (!(d > dur - 1.5)) throw new Error(`rendition ${f} is ${d.toFixed(1)}s but source is ${dur.toFixed(1)}s: truncated encode (source read interrupted)`);
    }
    steps.push({ step: "encode", wall_s: et.wall_s, cpu_s: (et.user_s || 0) + (et.sys_s || 0), detail: `${v.width}x${height} ${dur.toFixed(1)}s -> ${r.out.trim().split("\n").pop()}` });
    log(`encode ${et.wall_s}s wall, ${((et.user_s || 0) + (et.sys_s || 0)).toFixed(0)}s cpu`);

    // 3. package + encrypt with the keys handed to us (never logged)
    const keyArg = [["VIDEO", keys.VIDEO], ["VIDEO_UHD", keys.VIDEO_UHD], ["AUDIO", keys.AUDIO]]
      .filter(([, k]) => k).map(([l, k]) => `label=${l}:key_id=${k.kid}:key=${k.key}`).join(",");
    await sh("/usr/bin/time", ["-f", "wall_s=%e user_s=%U sys_s=%S maxrss_kb=%M", "-o", `${dir}/package.time`,
      "/work/package.sh", `${dir}/renditions`, `${dir}/packaged`, keyArg, keys.scheme || "cbcs", keys.iv || ""]);
    const pt = parseTime(await fs.readFile(`${dir}/package.time`, "utf8"));
    const drmFiles = await walk(`${dir}/packaged`);
    steps.push({ step: "package", wall_s: pt.wall_s, cpu_s: (pt.user_s || 0) + (pt.sys_s || 0), detail: `${drmFiles.length} files, ${keys.scheme || "cbcs"}` });

    // 3b. protected-URL version (only when the job asks for it): the same renditions packaged CLEAR into packaged/url/.
    //     No keys involved; the Worker guards every file behind the signed pass instead.
    const protections = String(job.protections || "drm").split(",");
    if (protections.includes("url")) {
      await sh("/usr/bin/time", ["-f", "wall_s=%e user_s=%U sys_s=%S maxrss_kb=%M", "-o", `${dir}/package_url.time`,
        "/work/package_clear.sh", `${dir}/renditions`, `${dir}/packaged/url`]);
      const ut = parseTime(await fs.readFile(`${dir}/package_url.time`, "utf8"));
      const urlFiles = await walk(`${dir}/packaged/url`);
      steps.push({ step: "package-url", wall_s: ut.wall_s, cpu_s: (ut.user_s || 0) + (ut.sys_s || 0), detail: `${urlFiles.length} files, clear (protected URL)` });
      log(`packaged protected-URL version: ${urlFiles.length} files`);
    }
    const files = await walk(`${dir}/packaged`);

    // 4. upload every output through the Worker endpoint (Class A write each)
    const t0 = Date.now(); let bytes = 0;
    const queue = [...files]; const workers = [];
    for (let i = 0; i < 6; i++) workers.push((async () => {
      while (queue.length) {
        const rel = queue.shift();
        const body = await fs.readFile(path.join(dir, "packaged", rel));
        bytes += body.length;
        for (let attempt = 1; ; attempt++) {
          let res, netErr;
          try { res = await fetch(uploadEndpoint + rel, { method: "PUT", headers: { authorization: `Bearer ${runnerToken}`, "content-type": "application/octet-stream" }, body }); }
          catch (e) { netErr = e; }   // network errors (fetch failed, reset) are retried like 5xx
          if (res?.ok) break;
          if (attempt >= 6) throw new Error(`upload ${rel} failed after ${attempt} attempts: ${netErr ? netErr.message : `${res.status} ${await res.text()}`}`);
          log(`upload ${rel} attempt ${attempt} failed (${netErr ? netErr.message : res.status}), retrying`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    })());
    await Promise.all(workers);
    steps.push({ step: "upload", wall_s: (Date.now() - t0) / 1000, bytes, detail: `${files.length} objects` });
    log(`uploaded ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    await fs.rm(dir, { recursive: true, force: true });
    await report(doneEndpoint, runnerToken, { ok: true, runner: RUNNER_NAME, steps });
    return { ok: true, steps };
  } catch (e) {
    log(`FAILED ${e.message}`);
    await fs.rm(dir, { recursive: true, force: true });
    await report(doneEndpoint, runnerToken, { ok: false, error: e.message.slice(0, 500), runner: RUNNER_NAME, steps }).catch(() => {});
    return { ok: false, error: e.message, steps };
  }
}
async function report(doneEndpoint, token, body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(doneEndpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      console.log(`done -> ${r.status} ${await r.text()}`); return;
    } catch (e) { if (attempt >= 6) throw e; await new Promise((r) => setTimeout(r, 2000 * attempt)); }
  }
}

// ---- HTTP: POST /encode (Phase B path) ----
http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return res.end(JSON.stringify({ ok: true, runner: RUNNER_NAME }));
  if (req.method === "POST" && req.url === "/encode") {
    let b = ""; for await (const c of req) b += c;
    const job = JSON.parse(b);
    res.writeHead(202, { "content-type": "application/json" }); res.end(JSON.stringify({ accepted: job.filmId }));
    await encodeJob(job);
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`encoder listening on ${PORT} as ${RUNNER_NAME}`));

// ---- POLL mode (Phase A path): pull jobs from the Worker ----
if (process.env.POLL_URL && process.env.RUNNER_TOKEN) {
  const base = process.env.POLL_URL.replace(/\/$/, ""), tok = process.env.RUNNER_TOKEN, every = Number(process.env.POLL_S || 10) * 1000;
  console.log(`poll mode: ${base}/jobs/next every ${every / 1000}s`);
  (async function loop() {
    for (;;) {
      try {
        const r = await fetch(`${base}/jobs/next`, { headers: { authorization: `Bearer ${tok}` } });
        if (r.status === 200) { const job = await r.json(); console.log(`job ${job.filmId}`); await encodeJob({ ...job, runnerToken: tok }); continue; }
        if (r.status !== 204) console.log(`poll ${r.status} ${await r.text()}`);
      } catch (e) { console.log(`poll error ${e.message}`); }
      await new Promise((s) => setTimeout(s, every));
    }
  })();
}
