// ztor-video Worker entry. Every request lands here; the first path segment picks the handler.
// Proposal section 4 map: step 3 uploads, step 4 workflow start, step 5 runner, step 7 play + media, step 8 license,
// step 9 pages. Accounts, the app API and the watch party were added on top (see README).
import type { Env } from "./lib/env";
import { json, err } from "./lib/env";
import { handleUploads } from "./routes/uploads";
import { handleFilms } from "./routes/films";
import { handleRunner } from "./routes/runner";
import { handlePlay } from "./routes/play";
import { handleMedia } from "./routes/media";
import { handleLicense } from "./routes/license";
import { handleAdmin } from "./routes/admin";
import { handleTest } from "./routes/test";
import { handleApp } from "./routes/app";
import { handleAuth } from "./lib/auth";
import { handleParty } from "./party/routes";
export { EncodeFilmWorkflow } from "./encode/workflow";   // encode pipeline (Workflow)
export { PartyRoom } from "./party/room";                 // watch party room (Durable Object)

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type,x-creator-id", "access-control-allow-methods": "GET,POST,PUT,OPTIONS" };
const page = (req: Request, env: Env, url: URL, file: string) => env.ASSETS.fetch(new Request(new URL(file, url.origin), { headers: req.headers }));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    const seg = p.split("/").filter(Boolean);
    try {
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      switch (seg[0]) {
        case undefined: return page(req, env, url, "/console.html");            // "/"
        case "uploads": return handleUploads(req, env, url, seg);
        case "films": return handleFilms(req, env, url, seg);
        case "jobs": return handleRunner(req, env, url, seg);
        case "play": return handlePlay(req, env, url, seg);
        case "media": return handleMedia(req, env, url, seg);
        case "license": return handleLicense(req, env, url, seg);
        case "admin": return handleAdmin(req, env, url, seg);
        case "test": return handleTest(req, env, url, seg);
        case "auth": return handleAuth(req, env, seg);                          // accounts and roles
        case "api": return handleApp(req, env, url, seg);                       // the app's API (session cookie)
        case "party": return handleParty(req, env, url, seg);                   // watch party rooms and SFU signalling
        case "app": return page(req, env, url, "/app.html");                    // the app: login, home, watch, party, admin
        case "watch": return page(req, env, url, "/watch.html");                // legacy party page
        case "player": return page(req, env, url, "/console.html");             // legacy test console
        case "health": if (p === "/health") return json({ ok: true, phase: "A", time: new Date().toISOString() });
      }
      return err("not found", 404);
    } catch (e: any) {
      return err(e?.message ?? String(e), 500);
    }
  },
} satisfies ExportedHandler<Env>;
