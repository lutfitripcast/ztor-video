// Proposal step 4 as written: R2 event notification -> Queue "encode-jobs" -> this consumer -> Workflow.
// Dormant in Phase A because Queues and R2 event notifications require the Workers Paid plan.
// To switch on (Phase B1):
//   1. wrangler.jsonc: add
//        "queues": { "consumers": [{ "queue": "encode-jobs", "max_batch_size": 10, "max_retries": 3, "dead_letter_queue": "encode-jobs-dlq" }] }
//      and export `queue` from src/index.ts:  export { queue } from "./queue";
//   2. npx wrangler queues create encode-jobs && npx wrangler queues create encode-jobs-dlq
//   3. npx wrangler r2 bucket notification create ztor-masters --event-type object-create --prefix "masters/" --queue encode-jobs
//   4. In /uploads/{id}/complete, stop calling ENCODE_FILM.create directly (the event will do it).
import type { Env } from "../lib/env";

// Shape of an R2 event notification message (object-create).
interface R2Event {
  account: string;
  bucket: string;
  eventTime: string;
  action: "PutObject" | "CompleteMultipartUpload" | "CopyObject" | "DeleteObject" | "LifecycleDeletion";
  object: { key: string; size: number; eTag: string };
}

export async function queue(batch: MessageBatch<R2Event>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const ev = msg.body;
    try {
      // masters/{filmId}/source.{ext}
      const m = /^masters\/([0-9a-f-]{36})\/source\./.exec(ev.object.key);
      if (!m || (ev.action !== "PutObject" && ev.action !== "CompleteMultipartUpload")) { msg.ack(); continue; }
      const filmId = m[1];
      const film = await env.DB.prepare("SELECT id, status, source_key FROM films WHERE id=?").bind(filmId).first<any>();
      if (!film) { msg.ack(); continue; }                       // unknown object, nothing to do
      if (!["uploading", "uploaded"].includes(film.status)) { msg.ack(); continue; }   // idempotent: already queued or beyond
      await env.DB.prepare("UPDATE films SET status='queued', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN ('uploading','uploaded')").bind(filmId).run();
      try { await env.ENCODE_FILM.create({ id: filmId, params: { filmId, sourceKey: film.source_key } }); }
      catch (e: any) { if (!/already exists|duplicate/i.test(e.message ?? "")) throw e; }   // same event delivered twice
      msg.ack();
    } catch (e) {
      msg.retry();   // transient failure: Queues redelivers with backoff, then dead-letters after max_retries
    }
  }
}
