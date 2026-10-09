# Option 5B: independent test of the build and of the cost claims

Date: 2026-09-21. Tested by re-reading the code and then probing the live Worker at `https://ztor-video.mluthfi840.workers.dev` as an outside client, with no reliance on the console's own "Run all checks" or on `BUILD_REPORT.md`. Meters were re-read from Cloudflare's analytics API with the Wrangler login. Scripts and raw results are in `test/audit/` (`audit.py` 85 probes, `inventory.py` HEAD of every object, `meters.py` analytics). Cost of this test: $0 billed; it added about 300 Worker requests, 1,400 R2 reads, 10 dummy licence rows and one aborted upload record.

## 1. Verdict

- **The build matches the proposal where BUILD_REPORT says it does.** 80 of 85 live probes passed. The 5 that did not are one known gap the report already lists (the 18-minute film still carries the old FairPlay key URI) and two exposures the report does not list (section 3).
- **BUILD_REPORT's cost numbers reproduce.** My meter read gives Class A 2,841 and Class B 33,207 against the report's 2,879 and 33,135; the difference is the test traffic in between. List price of everything done so far: about $0.03 in requests plus a few cents of storage. Whether Cloudflare actually billed $0 I could not read: the Wrangler token has no billing scope (section 4.4).
- **The proposal's Cloudflare column is right in shape and low in two lines.** Recomputed from the objects actually in R2: $2.61 to $8.66 per 1-hour 4K film at 1,000 views, against the proposal's $1.7 to $2.7. Encode and cache-miss reads are the lines that move.
- **The proposal's DRM line is the one that does not hold at this scale.** Published vendor floors are $200 to $500 a month before any per-licence price. One film at 1,000 views pays that whole fee alone: $0.20 to $0.50 per view, not $0.01 to $0.04. The headline per-view price only appears once the catalogue carries tens of thousands of plays a month.
- **Not tested here, needs you:** browser playback (step 9), the Cloudflare invoice, the Axinom licence count. Section 6.

## 2. Test 1: does the app match the 12 steps?

Legend: **Yes** = proposal text met and verified live. **Partial** = same behaviour by a different route, or part missing. **No** = not built. "Report" = what BUILD_REPORT claims; "Audit" = what I found.

| Step | Proposal requirement | Audit evidence | Result | Agrees with report? |
|---|---|---|---|---|
| 1 | Workers Paid, DRM vendor, Apple request | `wrangler containers list` refused: "requires the Workers Paid plan", so the account is Free. Axinom tenant answers licence calls (upstream 200 in D1). No Apple. | Partial | Yes |
| 2 | Two buckets, masters private, streams on a custom domain, cache rules | Buckets exist. S3 endpoint without credentials: 400. Both r2.dev URLs disabled (401, API says `enabled:false`). No custom domain (`domains/custom` empty), no zone on the account, so no Cache Rules or WAF possible. Cache headers are set by the Worker: segments `public, max-age=31536000, immutable`, manifests `private, max-age=60`, filtered HLS master `no-store`. | Partial | Yes |
| 3 | Presigned multipart upload, D1 film record, 2 GB test | Dry run: 250 MB request returned 3 presigned PUT URLs, SigV4, `X-Amz-Expires=3600`, bucket `ztor-masters`, D1 row `uploading`, abort worked. No creator header gives 401. Prior 2.096 GB upload is on the meter (73 UploadPart, 4 CompleteMultipartUpload). | Yes | Yes |
| 4 | Event notification, Queue, consumer, Workflow, idempotent | No Queues on the account, no notification config on `ztor-masters` (API code 11015). Completion starts the Workflow directly; 20 instances listed, ids equal film ids so a duplicate create fails harmlessly. Consumer code exists, dormant. | Partial | Yes |
| 5 | Container standard-4, ffmpeg + Shaka, H.264 ladder, 2 s GOP, 6 s CMAF, cbcs, upload to streams | Runs in Docker on this Mac (Containers refused on Free). From the objects in R2: keyframes at exactly 0, 2, 4, 6, 8, 10 s in every rendition checked; segments 6.0 s video, 6.01 s audio; static MPD; ladder 2160/1080/720/480/360 + AAC; measured averages 15.5 / 5.8 / 2.9 / 1.5 / 0.8 / 0.13 Mbps, matching the proposal's targets within 5%. Widevine and PlayReady signalled in DASH, FairPlay + PlayReady + Widevine in HLS. Scheme: trailers cbcs, 18-min film cenc. | Partial | Yes |
| 6 | Vendor keys, key IDs only in D1, raw keys never stored | Key IDs in MPD, HLS `skd://` URIs and `tenc` boxes all equal the D1 `film_keys` rows. Raw keys are in KV (3 entries), not from the vendor. Entitlement to Axinom carries the keys inline, encrypted to the communication key. | Partial | Yes |
| 7 | 4 h JWT, 402 without rental, gated manifests, public segments | All three films: 402 without rental with the exact message; 401 without login; `exp - iat = 14400`; claims sub, filmId, deviceId, uhd. MPD: 401 with no pass, forged pass, tampered claims, or another film's pass; 200 with header or `?t=`. Media playlists 401 without pass. Segments 200 with no pass, `accept-ranges: bytes`, HEAD works. | Yes | Yes |
| 8 | License routes to vendor, JWT required, 10/min, 48 h / no offline / HDCP for 2160p, one D1 row per licence | 401 without pass; ClearKey route 410. Burst of 12: `[200 x10, 429, 429]`, D1 rows +10. Entitlement: expiry equals the rental expiry, `allow_persistence=false`, UHD policy `HW_SECURE_ALL` + HDCP 2.2 (Widevine), level 3000 (PlayReady), `TYPE1` (FairPlay); 2 keys without HDCP claim, 3 with. Sent to Axinom directly: valid signature 200, one-character change: 400 "invalid signature". FairPlay certificate 1,242 bytes. | Yes | Yes, with one caveat (3.2) |
| 9 | Shaka web, iOS, Android, "up to 1080p" message | Web only. Policy filter on the HLS master verified: 2160p variant absent without HDCP, present with it, pass carried in every URI. Playback itself not re-tested here (needs your browsers). D1 holds this morning's evidence: FairPlay upstream 200 for SPL2 and the 4K trailer, Widevine 200 for the 18-min film, FairPlay 400 for the 18-min film. | Partial | Yes |
| 10 | Free content on Stream | Not built. | No | Yes |
| 11 | Real 1-h 4K encode on Containers, screen-record, 4 cities, invoice | Only an 18-min encode on this Mac. Nothing on Containers, no devices, no probes, no invoice. | Partial | Yes |
| 12 | Launch, weekly meters | Not in scope; the D1 tables exist. | No | Yes |

Encode telemetry in D1 (`encode_runs`) that the report's figures rest on, re-read: 18.3-min 4K film 4,192 s wall / 14,993 s CPU (3.8x realtime); 122 s 4K trailer 470 to 626 s wall across versions; 73 s 1080p trailer 92 to 545 s wall, the spread being network-bound reads of the master over the hotspot.

## 3. Findings BUILD_REPORT does not state

1. **The test routes are open to the internet.** With `TEST_MODE=true` on the public URL, `POST /test/rent` grants a 48-hour rental to any user id with no credential, and `GET /test/drm-token/{film}` hands out a signed Axinom entitlement that a real device could use against the vendor directly. My audit used both. The report says to set the flag to false "before exposing the Worker to real users"; the Worker is already exposed. Set it now, or gate `/test/*` behind the runner token.
2. **A Widevine play writes two D1 rows, not one.** Every Chrome play in the log shows two rows one second apart, both status 200; the first is Shaka's service-certificate request (the same `\x08\x04` body my probe used), which Axinom answers with the certificate, not a licence. The report's "1 licence per Widevine play" is what the vendor will bill; the D1 log says 2. Step 8's "D1 count matches the vendor dashboard" will fail unless certificate requests are tagged or skipped.
3. **The media path is not the proposal's.** The proposal serves segments from a custom domain in front of R2, cached by the CDN. The build serves every segment through the Worker: each one is a Worker request plus an R2 Class B read, and nothing is cached at the edge. On the Free plan (100,000 requests a day) that is about 82 full 1-hour views a day. On Paid it is inside the 10 M included requests until roughly 8,000 full views a month, then $0.30 per million. The fix is the custom domain from step 2, which needs a zone.
4. **The 18-minute film fails FairPlay, as the report says, and here is the count:** 18 FairPlay requests from Safari this morning, all upstream 400 ("key ID in asset ID is not a valid GUID", later "initialization vector"). Its HLS still has one `skd://ztor/...` URI without IV. Requeue it to fix.
5. **DASH is not policy-filtered.** Only the HLS master drops the 2160p variant for non-HDCP passes. The DASH manifest lists 2160p for everyone; the UHD key is withheld so it cannot decrypt, and the web player applies `maxHeight` itself. Harmless with Shaka, but a DASH client that ignores restrictions will stall on 4K instead of falling back.
6. **Storage in the report is quoted at peak, R2 bills the monthly average.** "9.5 GB, $0.14 per month" is the instantaneous peak. The masters bucket has sat at 3.85 to 4.55 GB and the streams bucket at 0.5 to 5.3 GB for two days; September's GB-month figure will be well under 1 GB-month, a fraction of a cent, all inside the 10 GB-month free allowance.
7. **Encode wall time is not encode time.** Several `encode_runs` rows show wall time 5 to 10 times CPU time (e.g. 3,058 s wall for 471 s CPU) because ffmpeg was reading the master over a hotspot. The 3.8x realtime figure comes from the run where CPU and wall agree (14,993 CPU-s over 4 cores = 3,748 s versus 4,192 s wall). The number is sound; the other rows are not usable for cost.

## 4. Test 2: is the cost as stated?

### 4.1 Meters, my read versus the report (2026-09-20 to 21, whole account)

| Meter | BUILD_REPORT | Audit read | List price of audit read |
|---|---|---|---|
| R2 Class A | 2,879 | 2,841 (masters 98, streams 2,572, pricing-test bucket 115, ListBuckets 56) | $0.0128 |
| R2 Class B | 33,135 | 33,207 (pricing-test bucket 31,865, streams 1,058, masters 284) | $0.0120 |
| R2 storage | 9.5 GB peak | masters peak 4.55 GB, now 3.85 GB (3 objects); streams peak 5.28 GB (1,880 objects at 08:00 UTC, before pruning); pricing-test bucket 1.76 GB, deleted 21st | under 1 GB-month for September so far, about $0.01 |
| Workers | 5,643 | 5,943 requests, 0 errors, CPU p50 1.1 ms, p99 6 ms | $0 (Free plan) |
| D1 | 45,933 read / 1,002 written | 54,159 rows read / 1,073 written; 3,000 read queries, 483 write queries | $0 |
| KV | 247 reads / 9 writes | 271 reads, 9 writes, 5 deletes, 1 list | $0 |
| Workflows | ~25 instances | 20 listed by Wrangler (analytics query rejected the status field) | $0 |
| **Total at list** | **$0.17** | **about $0.03 requests + about $0.01 storage** | the report's $0.14 storage line is the peak-based overstatement in 3.6 |

Every meter is inside its free allowance. **Whether the invoice shows $0 is unverified**: `GET /accounts/{id}/billing/history` and `/subscriptions` return "Authentication error" for the Wrangler OAuth token.

### 4.2 Unit prices, fetched today from Cloudflare's pages

R2 Standard $0.015/GB-month, Infrequent Access $0.01, Class A $4.50/M, Class B $0.36/M, egress free, free tier 10 GB-month / 1 M A / 10 M B. Workers Free 100k requests/day; Paid $5/month, 10 M requests and 30 M CPU-ms included, then $0.30/M and $0.02/M CPU-ms. Containers $0.000020/vCPU-s, $0.0000025/GiB-s, $0.00000007/GB-s, included 375 vCPU-min, 25 GiB-h, 200 GB-h, Paid required; container egress $0.025 to $0.05/GB after 500 GB to 1 TB. D1 free 5 M reads/100k writes a day. KV free 100k reads/1k writes a day. Queues Paid only, 1 M ops included then $0.40/M. Workflows free 100k requests/day, 3,000 steps/day; steps and storage billed from 2026-08-10 on Paid. Stream $5 per 1,000 minutes stored, $1 per 1,000 minutes delivered. CDN terms: "Unless you are an Enterprise customer, Cloudflare offers specific Paid Services (e.g., the Developer Platform, Images, and Stream) that you must use in order to serve video and other large files via the CDN." R2 is not named; it belongs to the Developer Platform. r2.dev: "rate-limited and should only be used for development"; caching, WAF and access controls need a custom domain, whose zone must be on the same account.

Every unit price in the proposal and in `test/REPORT.md` matches these pages. A standard-4 container costs $0.401 per hour.

### 4.3 The proposal's per-film table, recomputed from what is in R2

Basis: the 18.3-minute 4K film (`becd8657` v1), 1,118 objects, 3.664 GB, HEADed one by one. Scaled to one hour: 12.0 GB of renditions in 3,662 objects; a full 1080p view fetches 2.68 GB and a full 2160p view 7.05 GB, each in 1,215 requests (video + audio segments + manifests). The 4K trailer gives the same figures within 2%.

| Line | Proposal | Audit | Why it differs |
|---|---|---|---|
| Storage / month | $0.45 (30 GB) | $0.28 (19 GB: 12 GB renditions + 6.9 GB H.264 master) to $5.13 (342 GB: dual packaging + ProRes HQ 4K master at 707 Mbps) | master format decides; dual packaging (cenc + cbcs) adds 12 GB |
| Writes, once | $0.02 (~4,000) | $0.017 (3,730) to $0.047 (10,500) | correct as written for single packaging |
| Reads, 1,000 views | ≤ $0.22 (≤ 600k) | $0.44 (1.22 M) with no cache; $0.02 at 95% hit | audio segments double the count; today there is no cache at all |
| Delivery, 1,000 views | $0 (3.6 TB) | $0 (2.7 to 7.0 TB) | proposal's 8 Mbps average sits between 1080p and 2160p |
| Encode, once | $1 to $2 (3 to 5 h) | $2.29 to $3.05 (5.7 to 7.6 h) | 3.8 h per hour of film measured on 4 M4 cores from an H.264 source; cloud vCPU assumed 1.5 to 2x slower; **never run on Containers**; the first 1.5 h a month are inside the included 375 vCPU-minutes |
| Access checks (Workers) | ~$0 | 1.22 M requests per 1,000 views because segments go through the Worker; $0 within Paid's 10 M, else $0.37 | architecture difference, section 3.3 |
| **Cloudflare per film** | **$1.7 to $2.7** | **$2.61 to $8.66** | BUILD_REPORT's $2.6 to $8.5 reproduces |
| Cloudflare per view | ~$0.002 | $0.0026 to $0.0087 | |

### 4.4 The DRM line

Measured licences per play (D1, upstream 200): Widevine 1 licence (plus 1 certificate round trip); FairPlay 2 at 1080p (video + audio keys), 3 with 2160p. The proposal's "2 per play" is the middle of the range.

Published vendor prices found today (list, before negotiation):

| Vendor | Plan | Monthly | Included | Setup | Source |
|---|---|---|---|---|---|
| EZDRM | Universal DRM | $199.99 | 10,000 licences | $99.99 | ezdrm.com/service-pricing |
| EZDRM | Universal Complete | $299.99 | 20,000 licences or 2,000 users | $199.99 | same; volume plans above 20k/month on request |
| DoveRunner | Multi-DRM MAU Standard | $299 | 1,000 monthly active users, then $6 per 100 users to 10k, $4 per 100 to 100k | | AWS Marketplace listing |
| DoveRunner | licence-based (MAL) | $499 | 20,000 licences | | doverunner.com blog via search; page itself returned 403 |
| Axinom | Mosaic DRM | prices only inside the portal after registration; a third-party summary says $259 entry for 100,000 licences or 2,000 users, nothing billed in unused months | | docs.axinom.com/general/billing; softlist.io |

What this does to the proposal's headline. One 1-hour film at 1,000 views a month needs 1,000 to 3,000 licences. Alone, that consumes none of the included volume and pays the full base fee: $200 to $500, i.e. **$0.20 to $0.50 per view**. The per-licence prices the proposal uses only exist as averages once the included volume is used: EZDRM $0.020 (Universal DRM) to $0.015 (Complete) per licence when the 10k or 20k are fully used; Axinom's quoted entry tier would be $0.0026 if all 100k were used. So:

| Catalogue plays / month | DRM cost per view (base fee spread, EZDRM Universal DRM to DoveRunner MAL) | Cloudflare per view | Total per view |
|---|---|---|---|
| 1,000 (one film) | $0.20 to $0.50 | $0.003 to $0.009 | $0.20 to $0.51 |
| 10,000 | $0.02 to $0.05 | $0.003 to $0.009 | $0.02 to $0.06 |
| 100,000 | about $0.02 list, lower only with a volume contract | $0.003 to $0.009 | $0.02 to $0.03 |

The proposal's $0.01 to $0.04 per view is reachable at 10,000 plays a month and above, or with a negotiated rate below list. Its "$10 to $40 per film" DRM line is not a per-film cost at any listed vendor; it is the base fee divided across the catalogue. `test/REPORT.md` and BUILD_REPORT already say the fixed floor dominates; the table above puts the numbers on it.

### 4.5 Still not measurable from here

- **Invoice = $0**: needs the dashboard (Billing, then Invoices) or a token with Billing Read.
- **Encode on Containers**: needs Workers Paid ($5) and about $2 to $3 of compute for a 1-hour job. The 1.5x to 2x slowdown is an assumption.
- **Cache hit rate**: needs a zone and a custom domain on `ztor-streams`. Until then every read is a Class B read and a Worker request.
- **Container egress**: whether uploads from a container to R2 count against the 500 GB to 1 TB allowance is not stated on the pricing page; worst case $0.30 to $0.60 per 4K film.

## 5. Corrections to BUILD_REPORT

1. Section 3.1 storage line: replace "$0.14 per month" with the GB-month figure; R2 averages storage over the month.
2. Section 3.4 "1 to 3 licences per play": add that the D1 log records 2 rows for a Widevine play because the certificate request is logged as a licence.
3. Section 7 "set TEST_MODE to false before exposing the Worker": the Worker is public now; the two open test routes are a live exposure, not a future one.
4. Section 2 step 2 "served by the Worker on workers.dev": add the consequence, no edge cache, one Class B read and one Worker request per segment, 100k/day cap on Free.
5. Section 3.3 encode line: state that no Container run has happened; the $2.40 to $3.20 is local timing times an assumed slowdown.

## 6. What only you can close

1. **Billing**: open Cloudflare Billing, then Invoices, and read the September line, or create an API token with Billing Read and pass it to me.
2. **Step 9 playback**: play SPL2 and the Vulgaria trailer in Safari and Vulgaria X9 in Chrome from the console, then tell me the time you did it. I will pull the licence rows for that window and count licences per play against what the console showed.
3. **Axinom dashboard**: read the licence count for today. D1 has 20 upstream-200 vendor rows before my probes (6 Widevine, 14 FairPlay) plus 10 Widevine certificate-request rows from this audit. If Axinom shows about 14 to 24, the certificate rows are not licences and finding 3.2 stands.
