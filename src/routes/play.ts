// Check the ticket (step 7): a 4-hour play pass for a rented film, in DRM mode or protected-URL mode.
import type { Env } from "../lib/env";
import { json, err } from "../lib/env";
import { hasRental } from "../lib/util";
import { signJwt } from "../lib/jwt";
import { fairplayCertificate, type VendorEnv } from "../lib/drm-vendor";
import { actingUser } from "../lib/auth";

export async function handlePlay(req: Request, env: Env, url: URL, seg: string[]): Promise<Response> {
  if (req.method === "POST" && seg[0] === "play" && seg.length === 2) {
    const filmId = seg[1];
    // caps = what the device claims. With a real DRM the license server learns HDCP / security level from the
    // device's DRM module, not from the client; Phase A takes the claim at face value to exercise the policy path.
    const body = await req.json<{ userId?: string; deviceId?: string; caps?: { hdcp?: boolean }; mode?: "drm" | "url" }>().catch(() => ({} as any));
    // logged-in session, or (TEST_MODE only) the legacy console's typed id
    const who = await actingUser(req, env, body.userId);
    if (!who) return err("userId required (login stub)", 401);
    body.userId = who.id;
    const film = await env.DB.prepare("SELECT status, version, protections FROM films WHERE id=?").bind(filmId).first<any>();
    if (!film) return err("film not found", 404);
    if (film.status !== "ready") return err(`film not ready (status ${film.status})`, 409);
    if (!(await hasRental(env, body.userId, filmId))) return json({ error: "Rent this film to watch it." }, 402);
    const iat = Math.floor(Date.now() / 1000);
    // mode "url": the protected-URL version (clear segments behind signed links). No DRM means no HDCP, so it is capped at 1080p.
    const mode: "drm" | "url" = body.mode === "url" ? "url" : "drm";
    if (mode === "url" && !String(film.protections ?? "drm").split(",").includes("url")) return err("this film has no protected-URL version", 409);
    // 2026-09-25 "medium" rule: the 2160p key is always entitled for the DRM version; the licence's UHD policy (hardware DRM,
    // no HDCP level) decides on the device. The client's HDCP claim no longer matters.
    const uhd = mode === "drm";
    const token = await signJwt({ sub: body.userId, filmId, deviceId: body.deviceId ?? "unknown", uhd, mode, iat, exp: iat + Number(env.JWT_TTL_S) }, env.JWT_SECRET);
    const base = `${url.origin}/media/${filmId}/v${film.version}${mode === "url" ? "/url" : ""}`;
    if (mode === "url") return json({ token, expiresInS: Number(env.JWT_TTL_S), mode, dash: `${base}/manifest.mpd?t=${token}`, hls: `${base}/master.m3u8?t=${token}`,
      drm: "none: protected URL (signed 4 h links on every manifest and segment; segments are clear once fetched)", vendorDrm: null,
      policy: { rentalWindowH: 48, offline: false, maxHeight: 1080, reason: "protected-URL version: no DRM, so no HDCP; capped at 1080p" } });
    const venv = env as VendorEnv;
    const vendor = venv.DRM_VENDOR ? { vendor: venv.DRM_VENDOR, widevine: `${url.origin}/license/widevine`, playready: `${url.origin}/license/playready`,
      fairplay: `${url.origin}/license/fairplay`, fairplayCertificate: `${url.origin}/license/fairplay/cert` } : null;
    return json({ token, expiresInS: Number(env.JWT_TTL_S), mode, dash: `${base}/manifest.mpd?t=${token}`, hls: `${base}/master.m3u8?t=${token}`,
      licenseUrl: `${url.origin}/license/clearkey`, drm: vendor ? `${vendor.vendor} (Widevine / PlayReady / FairPlay)` : "clearkey (Phase A stand-in for Widevine/FairPlay/PlayReady)", vendorDrm: vendor,
      policy: { rentalWindowH: 48, offline: false, maxHeight: 2160, reason: "2160p key entitled for every DRM device (open rule, 2026-09-25)." } });
  }
  return err("not found", 404);
}
