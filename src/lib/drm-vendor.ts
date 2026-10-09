// Proposal step 8 as written: /license/{widevine|playready|fairplay} proxied to the DRM vendor.
// Vendor: Axinom DRM (Mosaic DRM Service). Format from docs.axinom.com/services/drm/license-service:
//   - License Service Message = { version: 1, com_key_id, message: <Entitlement Message v2> }
//   - wrapped in a JWT, HS256, secret = base64-decoded Communication Key, no iat/exp timestamps
//   - sent as HTTP header "X-AxDRM-Message" (or ?AxDrmMessage=) with the player's opaque license request body
//   - content keys inline: encrypted_key = AES-CBC(commKey, iv = keyId bytes, no padding) of the 16-byte key,
//     iv = the content IV (required for FairPlay), usage_policy names a policy in content_key_usage_policies
// Dormant until DRM_VENDOR is set; /license/clearkey stays for Phase A.
import type { Env } from "./env";
import type { PlayClaims } from "./jwt";

export type Drm = "widevine" | "playready" | "fairplay";
export interface FilmKeys { VIDEO: { kid: string; key: string }; VIDEO_UHD?: { kid: string; key: string }; AUDIO: { kid: string; key: string }; iv?: string; scheme?: string }

export interface VendorEnv extends Env {
  DRM_VENDOR?: string;                 // "axinom"
  DRM_COM_KEY_ID?: string;             // Communication Key ID (GUID)      secret
  DRM_COM_KEY?: string;                // Communication Key, base64         secret
  DRM_LICENSE_URL_WIDEVINE?: string;   // https://<tenant>.../AcquireLicense
  DRM_LICENSE_URL_PLAYREADY?: string;
  DRM_LICENSE_URL_FAIRPLAY?: string;
  DRM_FAIRPLAY_CERT_URL?: string;      // Axinom evaluation FairPlay certificate (trial) or Ztor's own (production)
}

// ---- helpers --------------------------------------------------------------------------------
const hexToBytes = (h: string) => Uint8Array.from(h.replace(/-/g, "").match(/../g)!.map((b) => parseInt(b, 16)));
const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
const b64u = (u8: Uint8Array | string) => (typeof u8 === "string" ? btoa(u8) : b64(u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const guid = (hex32: string) => { const h = hex32.replace(/-/g, "").toLowerCase(); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

/** AES-CBC, key = communication key, IV = key id, no padding: WebCrypto pads, so encrypt and keep the first block. */
async function encryptContentKey(commKey: Uint8Array, kidHex: string, keyHex: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", commKey, { name: "AES-CBC" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: hexToBytes(kidHex) }, k, hexToBytes(keyHex)));
  return b64(ct.slice(0, 16));
}

async function signHS256(payload: unknown, secret: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64u(sig)}`;
}

// ---- policy (proposal step 8): 48 h rental window, no offline, HDCP + hardware DRM for 2160p ----------------
const POLICIES = [
  { name: "SD_HD",
    widevine: { device_security_level: "SW_SECURE_CRYPTO" },
    playready: { min_device_security_level: 150 },
    fairplay: { hdcp: "NONE", allow_airplay: true, allow_av_adapter: true } },
  // "Open" rule (user decision 2026-09-25, after "medium" still locked 4K on the user's phone, whose Widevine is
  // software): the 2160p key has the same requirements as the other keys, so every device that can decode 4K plays it.
  // To go back to "medium" (hardware DRM only): widevine HW_SECURE_ALL, playready 3000. To "strict": add hdcp "2.2" / TYPE1.
  { name: "UHD",
    widevine: { device_security_level: "SW_SECURE_CRYPTO" },
    playready: { min_device_security_level: 150 },
    fairplay: { hdcp: "NONE", allow_airplay: true, allow_av_adapter: true } },
];

/** Build the Axinom License Service Message for this viewer's pass. All three keys are entitled; the UHD usage policy
 *  (hardware DRM) decides on the device whether the 2160p key is delivered, so no client claim gates it any more. */
export async function axinomMessage(env: VendorEnv, claims: PlayClaims, keys: FilmKeys, rentalExpiresIso: string) {
  if (!env.DRM_COM_KEY || !env.DRM_COM_KEY_ID) throw new Error("DRM_COM_KEY / DRM_COM_KEY_ID not configured");
  const commKey = fromB64(env.DRM_COM_KEY);
  const ivB64 = keys.iv ? b64(hexToBytes(keys.iv)) : undefined;
  const inline: any[] = [];
  const add = async (k: { kid: string; key: string }, usage_policy: string) =>
    inline.push({ id: guid(k.kid), encrypted_key: await encryptContentKey(commKey, k.kid, k.key), ...(ivB64 ? { iv: ivB64 } : {}), usage_policy });
  await add(keys.VIDEO, "SD_HD");
  await add(keys.AUDIO, "SD_HD");
  if (keys.VIDEO_UHD) await add(keys.VIDEO_UHD, "UHD");   // was: only when the pass claimed HDCP (until 2026-09-25)
  const message = {
    type: "entitlement_message", version: 2,
    license: { expiration_datetime: rentalExpiresIso, allow_persistence: false,   // rental window, no offline
      fairplay: { real_time_expiration: false }, playready: { real_time_expiration: false } },
    content_keys_source: { inline },
    content_key_usage_policies: POLICIES,
  };
  const lsm = { version: 1, com_key_id: env.DRM_COM_KEY_ID, message };
  return { token: await signHS256(lsm, commKey), keyIds: inline.map((k) => k.id), message };
}

/** Proxy the player's license request to Axinom with the signed entitlement; return the opaque license unchanged. */
export async function vendorLicense(req: Request, env: VendorEnv, drm: Drm, claims: PlayClaims, keys: FilmKeys, rentalExpiresIso: string): Promise<{ response: Response; keyIds: string[] }> {
  const url = drm === "widevine" ? env.DRM_LICENSE_URL_WIDEVINE : drm === "playready" ? env.DRM_LICENSE_URL_PLAYREADY : env.DRM_LICENSE_URL_FAIRPLAY;
  if (!env.DRM_VENDOR || !url) {
    return { response: new Response(JSON.stringify({ error: `/${drm} needs the DRM vendor configured (Phase B3); Phase A uses /license/clearkey` }), { status: 501, headers: { "content-type": "application/json" } }), keyIds: [] };
  }
  const { token, keyIds } = await axinomMessage(env, claims, keys, rentalExpiresIso);
  const upstream = await fetch(url, { method: "POST", body: req.body, headers: {
    "content-type": req.headers.get("content-type") ?? "application/octet-stream", "X-AxDRM-Message": token } });
  const h = new Headers(); h.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
  h.set("access-control-allow-origin", "*"); h.set("access-control-expose-headers", "X-AxDRM-Message");
  const info = upstream.headers.get("X-AxDRM-Message") ?? upstream.headers.get("x-axdrm-errormessage"); if (info) h.set("X-AxDRM-Message", info);   // vendor diagnostics on errors
  return { response: new Response(upstream.body, { status: upstream.status, headers: h }), keyIds };
}

/** FairPlay application certificate: fetched from the vendor (trial certificate) and cached at the edge. */
export async function fairplayCertificate(env: VendorEnv): Promise<Response> {
  if (!env.DRM_FAIRPLAY_CERT_URL) return new Response(JSON.stringify({ error: "DRM_FAIRPLAY_CERT_URL not configured" }), { status: 501 });
  const r = await fetch(env.DRM_FAIRPLAY_CERT_URL, { cf: { cacheTtl: 3600, cacheEverything: true } } as any);
  return new Response(r.body, { status: r.status, headers: { "content-type": "application/octet-stream", "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" } });
}
