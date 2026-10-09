// Media (step 7): manifests need the pass and are filtered by policy; DRM segments are public but encrypted; every object of
// the protected-URL version needs the pass.
import type { Env } from "../lib/env";
import { err } from "../lib/env";
import { MIME, ext, isManifest } from "../lib/util";
import { verifyJwt, bearer } from "../lib/jwt";

export async function handleMedia(req: Request, env: Env, url: URL, seg: string[]): Promise<Response> {
  if ((req.method === "GET" || req.method === "HEAD") && seg[0] === "media" && seg.length >= 3) {
    const filmId = seg[1];
    const rel = seg.slice(2).join("/");
    const urlVersion = /^v\d+\/url\//.test(rel);   // protected-URL version: clear files, so EVERY object needs the pass
    const t = bearer(req, url);
    const claims = t ? await verifyJwt(t, env.JWT_SECRET) : null;
    if (urlVersion) {
      if (!claims || claims.filmId !== filmId || claims.mode !== "url") return err("valid protected-URL pass required", 401);
    } else if (isManifest(rel)) {
      if (!claims || claims.filmId !== filmId || claims.mode === "url") return err("valid play token required for manifests", 401);
    }
    const obj = await env.STREAMS.get(`films/${filmId}/${rel}`);
    if (!obj) return err("not found", 404);
    if (/master\.m3u8$/i.test(rel)) {
      // Safari's native HLS player cannot add headers and ignores client-side restrictions, so:
      //  1. carry the pass into the media playlist links as ?t=
      //  2. enforce the policy here: drop variants taller than the pass allows (step 8/9: no HDCP -> up to 1080p)
      const maxH = claims?.uhd && !urlVersion ? 2160 : 1080;
      const lines = (await obj.text()).split("\n"); const out: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("#EXT-X-STREAM-INF")) {
          const h = Number(/RESOLUTION=\d+x(\d+)/.exec(line)?.[1] ?? 0);
          if (h > maxH) { i++; continue; }                       // skip this variant and its URI line
          out.push(line); out.push(`${(lines[++i] ?? "").trim()}?t=${t}`); continue;
        }
        out.push(line.replace(/URI="([^"]+\.m3u8)"/g, `URI="$1?t=${t}"`));
      }
      return new Response(out.join("\n"), { headers: { "content-type": "application/vnd.apple.mpegurl", "access-control-allow-origin": "*", "cache-control": "private, no-store" } });
    }
    if (/\.mpd$/i.test(rel)) {
      const maxH = claims?.uhd && !urlVersion ? 2160 : 1080;
      // Shaka Packager puts width/height on the AdaptationSet when it holds one Representation, otherwise on each Representation.
      // Drop Representations above the policy; drop whole AdaptationSets whose own height is above it or that end up empty.
      let mpd = (await obj.text()).replace(/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/g, (set) => {
        const open = /<AdaptationSet\b[^>]*>/.exec(set)![0];
        if (/contentType="audio"|mimeType="audio/.test(open)) return set;
        const setH = Number(/\b(?:max)?[hH]eight="(\d+)"/.exec(open)?.[1] ?? 0);
        if (setH > maxH && !/<Representation\b[^>]*\bheight="/.test(set)) return "";
        const filtered = set.replace(/<Representation\b[^>]*\bheight="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/Representation>)/g, (m, h) => Number(h) > maxH ? "" : m);
        return /<Representation\b/.test(filtered) ? filtered : "";
      });
      // protected-URL version: every init and media template carries the pass, so segments cannot be fetched without it
      if (urlVersion) mpd = mpd.replace(/\b(initialization|media)="([^"]+)"/g, (_m, attr, v) => `${attr}="${v}?t=${t}"`);
      return new Response(mpd, { headers: { "content-type": "application/dash+xml", "access-control-allow-origin": "*", "cache-control": "private, no-store" } });
    }
    if (urlVersion && /\.m3u8$/i.test(rel)) {
      // media playlist of the protected-URL version: sign the init map and every segment line
      const out = (await obj.text()).split("\n").map((line) => {
        if (line.startsWith("#EXT-X-MAP")) return line.replace(/URI="([^"]+)"/, (_m, u) => `URI="${u}?t=${t}"`);
        if (line.trim() && !line.startsWith("#")) return `${line.trim()}?t=${t}`;
        return line;
      });
      return new Response(out.join("\n"), { headers: { "content-type": "application/vnd.apple.mpegurl", "access-control-allow-origin": "*", "cache-control": "private, no-store" } });
    }
    const h = new Headers();
    h.set("content-type", MIME[ext(rel)] ?? obj.httpMetadata?.contentType ?? "application/octet-stream");
    h.set("etag", obj.httpEtag);
    h.set("accept-ranges", "bytes");
    h.set("access-control-allow-origin", "*");
    h.set("cache-control", urlVersion ? "private, max-age=14400" : isManifest(rel) ? "private, max-age=60" : "public, max-age=31536000, immutable");
    h.set("content-length", String(obj.size));
    return new Response(req.method === "HEAD" ? null : obj.body, { headers: h });
  }
  return err("not found", 404);
}
