export interface Env {
  ASSETS: Fetcher;
  MASTERS: R2Bucket;
  STREAMS: R2Bucket;
  DB: D1Database;
  KEYS: KVNamespace;
  ENCODE_FILM: Workflow;
  PARTY: DurableObjectNamespace;           // watch party rooms (src/party.ts)
  LICENSE_RL: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  R2_ACCOUNT_ID: string;
  MASTERS_BUCKET: string;
  STREAMS_BUCKET: string;
  PART_SIZE_MB: string;
  JWT_TTL_S: string;
  KEY_SCHEME?: string;
  LICENSE_RATE_LIMIT?: string;   // per viewer per minute; "0" disables (test phase). Proposal step 8 says 10.
  TEST_MODE?: string;
  DRM_VENDOR?: string;
  TEST_KEY?: string;
  REALTIME_APP_ID?: string;                // Cloudflare Realtime SFU app (watch party host camera / mic / screen)
  TURN_KEY_ID?: string;                    // optional: Realtime TURN key for viewers behind strict NATs
  // secrets
  JWT_SECRET: string;
  RUNNER_TOKEN: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  REALTIME_APP_SECRET?: string;            // secret: Realtime SFU app secret
  TURN_KEY_API_TOKEN?: string;             // secret: Realtime TURN key token
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json", ...headers } });

export const err = (message: string, status: number) => json({ error: message }, status);

export const now = () => new Date().toISOString();
