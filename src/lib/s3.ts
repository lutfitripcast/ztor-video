// Presigned S3-API URLs for R2 (proposal step 3: the big file never passes through our servers,
// step 5: the encoder only ever gets presigned URLs, no bucket binding).
import { AwsClient } from "aws4fetch";
import type { Env } from "./env";

function client(env: Env) {
  return new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
}
const endpoint = (env: Env, bucket: string, key: string) =>
  `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

export async function presign(env: Env, method: string, bucket: string, key: string, query: Record<string, string> = {}, expiresS = 3600) {
  const url = new URL(endpoint(env, bucket, key));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set("X-Amz-Expires", String(expiresS));
  const signed = await client(env).sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

export async function createMultipart(env: Env, bucket: string, key: string, contentType: string): Promise<string> {
  const url = endpoint(env, bucket, key) + "?uploads";
  const r = await client(env).fetch(url, { method: "POST", headers: { "content-type": contentType } });
  const body = await r.text();
  if (!r.ok) throw new Error(`CreateMultipartUpload ${r.status}: ${body.slice(0, 300)}`);
  const m = body.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!m) throw new Error("no UploadId in response");
  return m[1];
}

export async function completeMultipart(env: Env, bucket: string, key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
  const xml = `<CompleteMultipartUpload>${parts
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.replace(/"/g, "&quot;")}</ETag></Part>`)
    .join("")}</CompleteMultipartUpload>`;
  const url = endpoint(env, bucket, key) + `?uploadId=${encodeURIComponent(uploadId)}`;
  const r = await client(env).fetch(url, { method: "POST", body: xml, headers: { "content-type": "application/xml" } });
  const body = await r.text();
  if (!r.ok) throw new Error(`CompleteMultipartUpload ${r.status}: ${body.slice(0, 300)}`);
  return body.match(/<ETag>([^<]+)<\/ETag>/)?.[1] ?? "";
}

export async function abortMultipart(env: Env, bucket: string, key: string, uploadId: string) {
  const url = endpoint(env, bucket, key) + `?uploadId=${encodeURIComponent(uploadId)}`;
  await client(env).fetch(url, { method: "DELETE" });
}
