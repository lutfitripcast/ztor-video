// Minimal HS256 JWT (proposal step 7: short-lived pass with userId, filmId, deviceId).
const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === "string" ? enc.encode(buf) : buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
};

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export interface PlayClaims { sub: string; filmId: string; deviceId: string; uhd?: boolean; mode?: "drm" | "url"; party?: string; role?: "host" | "viewer"; name?: string; exp: number; iat: number }   // mode: which protected version the pass opens; party/role: watch-party ticket (a url-mode pass bound to one room)

export async function signJwt(claims: PlayClaims, secret: string) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<PlayClaims | null> {
  try { return await verifyJwtInner(token, secret); } catch { return null; }
}
async function verifyJwtInner(token: string, secret: string): Promise<PlayClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const ok = await crypto.subtle.verify("HMAC", await key(secret), unb64u(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const claims = JSON.parse(new TextDecoder().decode(unb64u(parts[1]))) as PlayClaims;
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

export function bearer(req: Request, url: URL): string | null {
  const h = req.headers.get("authorization");
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return url.searchParams.get("t");
}
