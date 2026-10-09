// Guard the key door (step 8): ClearKey for the free path, vendor license proxies (Widevine, PlayReady, FairPlay) for DRM.
import type { Env } from "../lib/env";
import { json, err } from "../lib/env";
import { licenseLimited } from "../lib/util";
import { verifyJwt, bearer } from "../lib/jwt";
import { vendorLicense, fairplayCertificate, type Drm, type VendorEnv } from "../lib/drm-vendor";

export async function handleLicense(req: Request, env: Env, url: URL, seg: string[]): Promise<Response> {
  if (req.method === "POST" && seg[1] === "clearkey" && seg.length === 2) {
    // ClearKey hands out raw keys: it exists only for the free path. With a real DRM vendor configured it must be closed,
    // otherwise any holder of a pass could bypass the vendor and decrypt everything.
    if ((env as VendorEnv).DRM_VENDOR) return err("ClearKey is disabled while a DRM vendor is configured", 410);
    const t = bearer(req, url);
    const claims = t ? await verifyJwt(t, env.JWT_SECRET) : null;
    if (!claims) return err("valid play token required", 401);
    if (await licenseLimited(env, claims.sub)) return err("too many license requests", 429);
    const keys = JSON.parse((await env.KEYS.get(`keys:${claims.filmId}`)) ?? "null");
    if (!keys) return err("no keys for film", 404);
    const b64u = (hex: string) => btoa(String.fromCharCode(...hex.match(/../g)!.map((h) => parseInt(h, 16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const requested = await req.json<{ kids?: string[]; type?: string }>().catch(() => ({} as any));
    // issue VIDEO + AUDIO always; VIDEO_UHD only when the pass carries the HDCP capability (step 8 policy)
    const issuable = [keys.VIDEO, keys.AUDIO, ...(keys.VIDEO_UHD && claims.uhd ? [keys.VIDEO_UHD] : [])];
    const all = issuable.map((k) => ({ kty: "oct", kid: b64u(k.kid), k: b64u(k.key) }));
    const out = requested.kids?.length ? all.filter((k) => requested.kids!.includes(k.kid)) : all;
    await env.DB.prepare("INSERT INTO licenses (user_id,film_id,device_id,drm,key_ids) VALUES (?,?,?,?,?)")
      .bind(claims.sub, claims.filmId, claims.deviceId, "clearkey", out.map((k) => k.kid).join(",")).run();
    return json({ keys: out, type: requested.type ?? "temporary" }, 200, { "access-control-allow-origin": "*" });
  }
  // ---------------- step 8 as written: vendor DRM license proxies (Phase B3) ------------------------
  if (req.method === "GET" && seg[0] === "license" && seg[1] === "fairplay" && seg[2] === "cert") return fairplayCertificate(env as VendorEnv);
  if (req.method === "POST" && seg[0] === "license" && ["widevine", "playready", "fairplay"].includes(seg[1] ?? "")) {
    const drm = seg[1] as Drm;
    const t = bearer(req, url);
    const claims = t ? await verifyJwt(t, env.JWT_SECRET) : null;
    if (!claims) return err("valid play token required", 401);
    if (await licenseLimited(env, claims.sub)) return err("too many license requests", 429);
    const keys = JSON.parse((await env.KEYS.get(`keys:${claims.filmId}`)) ?? "null");
    if (!keys) return err("no keys for film", 404);
    const rental = await env.DB.prepare("SELECT expires_at FROM rentals WHERE user_id=? AND film_id=? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(claims.sub, claims.filmId).first<{ expires_at: string }>();
    if (!rental) return json({ error: "Rent this film to watch it." }, 402);
    const ct = req.headers.get("content-type") ?? "";
    const { response, keyIds } = await vendorLicense(req, env as VendorEnv, drm, claims, keys, rental.expires_at);
    const detail = [response.headers.get("X-AxDRM-Message") ?? "", `req-ct=${ct}`, `resp-ct=${response.headers.get("content-type") ?? ""}`].filter(Boolean).join(" | ").slice(0, 500);
    await env.DB.prepare("INSERT INTO licenses (user_id,film_id,device_id,drm,key_ids,upstream_status,detail) VALUES (?,?,?,?,?,?,?)")
      .bind(claims.sub, claims.filmId, claims.deviceId, drm, keyIds.join(","), response.status, detail).run();
    return response;
  }
  return err("unknown license route", 404);
}
