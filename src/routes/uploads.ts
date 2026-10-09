// Creator upload (proposal step 3): presigned multipart parts into the private masters bucket; completion starts the
// encode-film Workflow (step 4, free-plan route: no R2 event notification or Queue needed).
import type { Env } from "../lib/env";
import { json, err } from "../lib/env";
import { creatorId } from "../lib/util";
import { presign, createMultipart, completeMultipart, abortMultipart } from "../lib/s3";

export async function handleUploads(req: Request, env: Env, url: URL, seg: string[]): Promise<Response> {
  if (req.method === "POST" && seg.length === 1) {
    const cid = creatorId(req);
    if (!cid) return err("missing X-Creator-Id (auth stub)", 401);
    const body = await req.json<{ title?: string; sizeBytes?: number; filename?: string }>();
    if (!body.sizeBytes || body.sizeBytes <= 0) return err("sizeBytes required", 400);
    const filmId = crypto.randomUUID();
    const extn = (body.filename?.split(".").pop() || "mov").toLowerCase().replace(/[^a-z0-9]/g, "") || "mov";
    const key = `masters/${filmId}/source.${extn}`;
    const partSize = Number(env.PART_SIZE_MB) * 1024 * 1024;
    const parts = Math.ceil(body.sizeBytes / partSize);
    if (parts > 10000) return err("file too large for 10,000 parts", 400);
    const uploadId = await createMultipart(env, env.MASTERS_BUCKET, key, "video/quicktime");
    await env.DB.prepare("INSERT INTO films (id,creator_id,title,status,source_key,upload_id) VALUES (?,?,?,?,?,?)")
      .bind(filmId, cid, body.title ?? "untitled", "uploading", key, uploadId).run();
    const urls: string[] = [];
    for (let n = 1; n <= parts; n++) urls.push(await presign(env, "PUT", env.MASTERS_BUCKET, key, { partNumber: String(n), uploadId }, 3600));
    return json({ filmId, key, uploadId, partSize, parts, urls, expiresInS: 3600 });
  }
  if (req.method === "POST" && seg[0] === "uploads" && seg[2] === "complete") {
    const filmId = seg[1];
    const film = await env.DB.prepare("SELECT * FROM films WHERE id=?").bind(filmId).first<any>();
    if (!film) return err("film not found", 404);
    if (film.status !== "uploading") return json({ filmId, status: film.status, note: "already completed" });
    const body = await req.json<{ parts: { partNumber: number; etag: string }[] }>();
    const etag = await completeMultipart(env, env.MASTERS_BUCKET, film.source_key, film.upload_id, body.parts);
    const head = await env.MASTERS.head(film.source_key);
    await env.DB.prepare("UPDATE films SET status='uploaded', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(filmId).run();
    // ---- step 4 (free route): start the Workflow directly. Idempotent: instance id = filmId.
    let workflow = "started";
    try { await env.ENCODE_FILM.create({ id: filmId, params: { filmId, sourceKey: film.source_key } }); }
    catch (e: any) { workflow = `exists (${e.message?.slice(0, 80)})`; }
    return json({ filmId, status: "uploaded", etag, sizeBytes: head?.size ?? null, workflow });
  }
  if (req.method === "DELETE" && seg[0] === "uploads" && seg.length === 2) {
    const film = await env.DB.prepare("SELECT * FROM films WHERE id=?").bind(seg[1]).first<any>();
    if (!film || film.status !== "uploading") return err("no upload in progress", 404);
    await abortMultipart(env, env.MASTERS_BUCKET, film.source_key, film.upload_id);
    await env.DB.prepare("UPDATE films SET status='failed', error='upload aborted' WHERE id=?").bind(seg[1]).run();
    return json({ filmId: seg[1], status: "aborted" });
  }
  return err("not found", 404);
}
