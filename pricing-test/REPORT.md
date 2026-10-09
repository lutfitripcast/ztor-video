# Option 5B pricing check against a real master

Date: 2026-09-20. Test file: `SPL2_TR02_ST_SUB.mov`. Everything below was measured on this machine inside the Docker image in this folder, except where a line is marked **assumed** or **extrapolated**. Unit prices come from Cloudflare's public pages, fetched today. Phase 6, a live run on a Cloudflare account, was done on the R2 free tier and confirmed the storage, write, read and egress lines against Cloudflare's own meters; see the Phase 6 section near the end.

## Verdict

The Cloudflare side of the proposal holds. For the 1-hour 4K film watched 1,000 times, Cloudflare's share comes out between $1.92 and $7.99 depending on master format and encode speed, against the proposal's $1.7 to $2.7. Per view that is $0.002 to $0.008. Delivery is confirmed at $0.

The per-view headline of $0.01 to $0.04 is entirely the DRM assumption. Nothing in this test verifies it and nothing on this machine can. It needs vendor quotes.

Three numbers in the proposal should change: the storage line (too low if masters are ProRes), the encode estimate (low end too optimistic), and the cache-miss line (counts video segments only). None of them moves the total by more than a few dollars.

## What the file is

| Property | Measured |
|---|---|
| Duration | 73.2 s |
| Resolution | 1920 x 1080 (not 4K) |
| Codec | Apple ProRes 422 HQ, 165.7 Mbps |
| Size | 1.517 GB |
| Frame rate | 24 fps |

Because the source is 1080p, the honest ladder is 4 rungs. The 2160p rung was still encoded, from an upscaled source, purely to time 4K encoding.

## Measured: encode on 4 pinned cores

Container was run with `--cpuset-cpus=0-3 --memory=7g` to mimic a standard-4 instance (4 vCPU, 12 GiB, 20 GB). x264 preset medium, 2-second GOP, bitrates as in the proposal.

| Rung | Wall s | CPU s | x realtime | Peak RSS |
|---|---|---|---|---|
| 2160p @ 16 Mbps (upscaled) | 161.2 | 632.2 | 2.20 | 1.95 GB |
| 1080p @ 6 Mbps | 52.5 | 205.8 | 0.72 | 600 MB |
| 720p @ 3 Mbps | 33.0 | 129.4 | 0.45 | 348 MB |
| 480p @ 1.5 Mbps | 22.6 | 87.2 | 0.31 | 232 MB |
| 360p @ 0.8 Mbps | 18.9 | 70.5 | 0.26 | 195 MB |
| AAC 128k | 0.9 | 0.9 | 0.01 | 58 MB |
| Combined 1080p-down ladder, one ffmpeg run | 101.1 | 392.7 | 1.38 | 1.05 GB |

A single combined run is about 20% faster than separate runs because the ProRes master is decoded once. Packaging with Shaka Packager took 0.8 s and is free.

Container cost per wall-second on standard-4: $0.0001114 (4 vCPU at $0.000020, 12 GiB at $0.0000025, 20 GB at $0.00000007).

## Measured: packaged output

CMAF, 6-second segments, cbcs encryption with separate video and audio keys, Widevine, PlayReady and FairPlay signalling confirmed in the manifests.

| Rendition | Files | MB | Mbps |
|---|---|---|---|
| 2160p | 14 | 139.6 | 15.25 |
| 1080p | 14 | 52.2 | 5.71 |
| 720p | 14 | 26.1 | 2.85 |
| 480p | 14 | 13.0 | 1.42 |
| 360p | 14 | 7.0 | 0.76 |
| Audio | 14 | 1.2 | 0.13 |
| Manifests | 8 | 0.02 | |
| Total | 92 | 239.1 | |

Each rendition is 1 init segment plus 13 media segments. A full 1080p watch fetches 31 objects and 53.5 MB.

## 1. This file on Option 5B

4-rung ladder, full watch at 1080p, R2 Standard storage, every request assumed to miss cache (worst case).

| Line | 1,000 views | 10,000 views | 100,000 views |
|---|---|---|---|
| Encode, once (101 s) | $0.011 | $0.011 | $0.011 |
| Storage per month (1.616 GB, 94% is the master) | $0.024 | $0.024 | $0.024 |
| R2 writes, once (77 objects) | $0.0003 | $0.0003 | $0.0003 |
| R2 reads, all cache misses | $0.011 | $0.11 | $1.12 |
| Delivery | $0 (53 GB) | $0 (534 GB) | $0 (5.3 TB) |
| **Cloudflare subtotal** | **$0.047** | **$0.15** | **$1.15** |
| DRM, 2 licenses per play, **assumed** $0.005 to $0.02 | $10 to $40 | $100 to $400 | $1,000 to $4,000 |
| Per view | $0.0100 to $0.0400 | $0.0100 to $0.0400 | $0.0100 to $0.0400 |

Cloudflare's share per view is under $0.00005. R2's free tier (10 GB, 1M Class A, 10M Class B per month) would zero every Cloudflare line for a single film. Only the $5 Workers Paid plan remains, and it is shared.

## 2. The proposal's 1-hour 4K film, re-projected

| Line | Proposal | Re-projected | Basis |
|---|---|---|---|
| Encode | 3 to 5 h, $1 to $2 | 3.6 h, $1.44 floor; 5.4 to 7.2 h, $2.15 to $2.87 likely | Measured 3.58x realtime for the 5-rung ladder. The 4K rung came from an upscaled 1080p source, so a true 4K master decodes 4x more pixels and carries real detail. **Extrapolated** 1.5x to 2x. |
| Storage | 30 GB, $0.45 | 30 GB, $0.45 if the master is a compressed delivery file. 86 GB, $1.30 for a ProRes HQ 1080p master. 310 GB, $4.65 for a ProRes HQ 4K master. | Measured ladder is 26.1 Mbps, 11.8 GB per hour. Master rate measured at 165.7 Mbps. Infrequent Access for the master brings the 4K case to $3.16. |
| R2 writes | ~4,000, $0.02 | 3,614 objects, $0.016. Plus about 3,000 multipart parts for a 4K ProRes master, $0.013. | 6 renditions x 601 files + 8 manifests |
| R2 reads | up to 600,000, $0.22 | 1,205 requests per view, so 1.21M worst case, $0.43. At 95% cache hit, $0.02. | Proposal counted video segments only. Audio segments double the count. |
| Delivery | 3.6 TB, $0 | 2.6 GB per view at 1080p, 6.9 GB at 2160p. $0 either way. | Measured bitrates. The proposal's 8 Mbps average implies roughly one in five views at 2160p. |
| DRM | $10 to $40 | $10 to $40 | **Assumed**, unchanged, not verified |
| **Cloudflare subtotal** | **$1.7 to $2.7** | **$1.92 to $7.99** | best case to ProRes 4K master, slow encode, no cache |
| **Total** | **$12 to $43** | **$11.92 to $47.99** | |

## Unit prices verified today

| Item | Price | Source |
|---|---|---|
| R2 Standard storage | $0.015 per GB-month | developers.cloudflare.com/r2/pricing |
| R2 Infrequent Access | $0.01 per GB-month | same |
| R2 Class A (PutObject, UploadPart, CompleteMultipartUpload) | $4.50 per million | same |
| R2 Class B (GetObject, HeadObject) | $0.36 per million | same |
| R2 egress | Free | same |
| R2 free tier | 10 GB-month, 1M Class A, 10M Class B | same |
| Containers vCPU | $0.000020 per vCPU-second | developers.cloudflare.com/containers/pricing |
| Containers memory | $0.0000025 per GiB-second | same |
| Containers disk | $0.00000007 per GB-second | same |
| Containers included per month | 375 vCPU-min, 25 GiB-h, 200 GB-h | same |
| standard-4 instance | 4 vCPU, 12 GiB, 20 GB disk, largest type | developers.cloudflare.com/containers/platform-details/limits |
| Workers Paid | $5 per month, 10M requests, 30M CPU-ms included | developers.cloudflare.com/workers/platform/pricing |
| Cache Rules | Available on the Free plan, 10 rules | developers.cloudflare.com/cache/how-to/cache-rules |
| r2.dev domain | Rate-limited, no caching, development only. Custom domain required for Cloudflare Cache. | developers.cloudflare.com/r2/buckets/public-buckets |
| CDN terms | "Cloudflare offers specific Paid Services (e.g., the Developer Platform, Images, and Stream) that you must use in order to serve video and other large files via the CDN." R2 is part of the Developer Platform. | cloudflare.com/service-specific-terms-application-services |

## Things the test surfaced that are not about price

- **The 20 GB container disk cannot hold a ProRes master.** A 1-hour ProRes HQ master is 75 GB at 1080p and around 300 GB at 4K. Step 5 of the proposal must stream the master straight from the presigned URL into ffmpeg and upload renditions as they finish, never download the whole file. The 12 GB of renditions for a 4K film fits, but only just, so uploading per rung is safer.
- **Containers egress has a price.** Data leaving a container is $0.025 to $0.05 per GB after a 500 GB to 1 TB monthly allowance. Whether uploads from a container to R2 count as egress is not stated on the pricing page. Worst case for a 4K film is about $0.30 to $0.60. Confirm during Phase 6 if it runs.
- **Peak memory is small.** The 2160p rung peaked at 1.95 GB, so a standard-3 (2 vCPU, 8 GiB) would also work at roughly half the vCPU cost and twice the wall time. The bill is nearly identical because Containers charge per vCPU-second.

## Sentences in the proposal to change

1. Section 2, "~30 GB stored: master + streaming copies". Change to state the master format. If ProRes masters are accepted: "~12 GB of streaming copies plus the master; a ProRes 4K master adds ~300 GB, about $4.65 a month on Standard or $3.16 on Infrequent Access."
2. Section 2, Encoding, "~3–5 hours on 4 vCPU ... ~$1–2". Change to "~3.6 hours measured floor from an upscaled test; expect 5 to 7 hours and $2 to $3 for a true 4K master."
3. Section 2, Cache misses, "≤ 600,000 reads × $0.36 per million, ≤ $0.22". Change to "≤ 1.2 million reads (video and audio segments) if nothing is cached, ≤ $0.43; about $0.02 at a 95% cache hit rate."
4. TL;DR, "Cloudflare's terms let us serve video through its CDN as long as the files are hosted on R2 or Stream." Replace with the exact quote from the terms and note that R2 falls under the Developer Platform.
5. Hero and TL;DR per-view figure. Add one clause: "almost all of which is the DRM license price."
6. Section 4, step 5. Add: "The container's 20 GB disk cannot hold a full master. Stream the source from the presigned URL and upload each rendition as it completes."

## Phase 6: live run on Cloudflare, free tier

Run on 2026-09-20 on the user's own Cloudflare account, R2 free tier, no paid plan. Bucket `ztor-5b-test` in the APAC region, public r2.dev URL, no custom domain, so no CDN cache in front. Meter readings come from Cloudflare's GraphQL analytics (`r2OperationsAdaptiveGroups`, `r2StorageAdaptiveGroups`), readable with the Wrangler login. Scripts: `upload_master.py`, `simulate_views.py`, `r2_metrics.py`; raw data in `out/views.csv`, `out/views_topup.csv`, `out/metrics_*.txt`.

**What was done**

- Uploaded all 92 packaged objects (239 MB) with `wrangler r2 object put`, one Class A write each.
- Uploaded the 1.517 GB master by S3 multipart, 15 parts of 100 MiB. The first attempt died on part 15 when the network dropped; the client aborted it cleanly and the second attempt succeeded. Nothing orphaned.
- Replayed viewer sessions against the public URL: 1,000 light views (Range request for the first KiB of each of the 31 objects) plus 20 full views. Two network outages killed 15,718 requests at the client before they left the machine; a top-up run replaced them. Final client-side successes: 31,111 light requests (1,003.6 views) and 632 full requests (20.4 views), 1.07 GB downloaded, zero non-2xx responses from Cloudflare at about 20 requests a second.

**Meter versus arithmetic**

| Line | Arithmetic in this report | Cloudflare meter | Match |
|---|---|---|---|
| Storage | 1.756 GB, 93 objects (master + 92 packaged) | 1.756 GB payload, 93 objects | exact |
| Class A writes for packaged objects | 92 | 92 PutObject success, plus 1 PutObject internalError from Cloudflare's side, 1 PutBucket | exact |
| Class A for the master multipart | 17 (1 create + 15 parts + 1 complete), 31 counting the failed attempt | 1 CreateMultipartUpload + 8 UploadPart visible, no CompleteMultipartUpload row | analytics under-reports S3-API multipart ops; cost effect below $0.0001 |
| Class B reads for 1,000 views | 31,000 (31 objects per view) | 31,479 in the view window; 31,857 for the whole day including verification fetches, against 31,743 client-side successes | within 0.4% |
| Egress | 1.07 GB downloaded | $0 | confirmed free |
| Class B cost at list price | 1,000 views x 31 / 1e6 x $0.36 = $0.0112 | $0.0115 | match |

**Cost of the whole live test at list prices:** Class A $0.00046, Class B $0.0115, storage $0.026 per month, egress $0. Total about $0.04. Actual bill: $0, all inside the free tier.

**Operational findings**

- **r2.dev is blocked by at least one Indonesian ISP.** XL Axiata hijacks DNS for every r2.dev name to a block page and resets TLS connections to Cloudflare's real address on that hostname. A hotspot on another carrier worked. Production traffic must go through a custom domain anyway, but any developer testing on r2.dev from such a network will see a dead URL.
- **Cloudflare returned one internal error on a plain PutObject.** Step 5's upload code needs retries; a 1-in-93 failure rate is enough to break an unattended encode job.
- **Range requests inflate the dashboard's byte count.** The meter recorded 54 GB of "response bytes" for 1.07 GB actually transferred, because R2 logs the full object size per request. No cost effect, but do not use that column to estimate viewer bandwidth.
- **Analytics lag.** Operation counts trailed real activity by 3 to 5 minutes and multipart S3-API operations were only partly visible. Reconcile against the monthly invoice, not the live graph.
- **No rate limiting seen on r2.dev** at 20 requests a second sustained for 25 minutes, but Cloudflare documents it as rate-limited and for development only.

**What this changes in the verdict**

Nothing in the numbers. Every Cloudflare line in section 2 is now backed by a meter reading rather than arithmetic alone: storage exact, writes exact, reads within 0.4%, egress $0. The two lines still not measured are the cache hit rate, which needs a custom domain, and the live container encode, which needs Workers Paid.


## 4K test: real 2160p source through the Phase A pipeline

Run 2026-09-21 on the Phase A build (see `../BUILD_PLAN.md`). Source: `Vulgaria trailer 4K upscale`, 3840x2160 H.264 High 15.1 Mbps, 122.1 s, 233 MB, 24 fps. It is an upscale of a 2012 trailer, so the picture is soft; and it is compressed H.264, not ProRes. Both make the encode time a **floor** for a native 4K master.

**Encode, measured on 4 pinned M4 cores, 5-rung ladder in one ffmpeg pass**

| | Value |
|---|---|
| Wall time | 491.6 s for 122.1 s of video = **4.03x realtime** |
| CPU time | 1,443 s |
| Package (Shaka, cenc) | 0.4 s |
| Upload | 140 objects, 399 MB |
| Peak memory | under 2 GB |

Scaled to a 1-hour film: 4.0 h on this Mac. Cloud vCPUs are slower; at 1.5x to 2x that is **6 to 8 hours on a standard-4 instance, $2.40 to $3.20**. The proposal's 3 to 5 hours and $1 to $2 is the optimistic edge of the range, and a native ProRes 4K master decodes far slower than this H.264 source, so real films sit above these numbers, not below.

**Renditions, measured**

| Rendition | Files | MB | Mbps |
|---|---|---|---|
| 2160p | 22 | 232.6 | 15.24 |
| 1080p | 22 | 87.1 | 5.71 |
| 720p | 22 | 43.7 | 2.87 |
| 480p | 22 | 21.9 | 1.43 |
| 360p | 22 | 11.7 | 0.77 |
| Audio | 22 | 2.1 | 0.13 |
| Manifests | 8 | 0.02 | |
| Total | 140 | 399.1 | 26.2 Mbps = 11.8 GB per hour stored |

A full 2160p view is 15.4 Mbps = **6.9 GB per hour**. The proposal's 3.6 GB per view therefore assumes roughly one viewer in five watching at 2160p. Delivery is $0 either way.

**Playback, headless Chrome**

- Forced to 2160p: decrypts and plays, one license, but rebuffers every 6 s because the test hotspot cannot sustain 18 Mbps. A network limit, not a pipeline one.
- Automatic quality: settles at 720p on the same hotspot and plays 0 to 122.1 s with 0 dropped frames.

**Failures on the way, all now guarded against in the runner**

Runs 1 to 3 produced a 33-second film that the pipeline marked ready. ffmpeg was reading the master over HTTPS, the connection dropped, and ffmpeg treated the drop as end of file and exited 0. Packaging and upload then succeeded on a third of the film. Fixes: ffmpeg reconnect flags for HTTP(S) sources, a duration guard that fails the job if any rendition is shorter than the source, upload retries on network errors, and IPv4 preference for Node inside Docker. Rule for step 5: verify output duration against the source; never trust exit code 0 from a streamed read.


**Policy path for 4K (added 2026-09-21).** Each film now carries three keys: one for rungs up to 1080p, one for 2160p, one for audio. The pass records whether the device claims HDCP; the license door issues the 2160p key only when it does, and the player shows "This device plays up to 1080p." otherwise. Verified: 3 keys versus 2 at the license door, banner and 4-track manifest without HDCP, 4K decrypting with it. With ClearKey the claim is client-asserted; the real vendor reads HDCP and security level from the device module, which is what makes step 8's policy enforceable in Phase B.


**18-minute 4K sample (2026-09-21).** The same trailer concatenated nine times, 1,099 s, 2.096 GB H.264 source, through the Phase A pipeline on this Mac: encode 4,192 s wall and 14,993 s CPU for the 5-rung ladder, 3.8x realtime, consistent with the 2-minute run. Renditions total 3.66 GB, 26.7 Mbps, so a 1-hour 4K film stores about 12 GB of renditions as section 2 projects. Scaled to 1 hour: 3.8 h on this Mac, 6 to 8 h on a standard-4 Container allowing 1.5x to 2x slower cloud vCPUs, $2.40 to $3.20. Packaging took 137 s for 18 minutes of content, negligible. This replaces the "extrapolated" label on the encode line with a measured 18-minute base; a native ProRes 4K master would still decode slower than this H.264 source.

## Not done, and why

- **CDN cache behaviour.** No domain on the account, so the test ran on r2.dev, which bypasses the cache. The cache-miss line stays bounded at $0.02 to $0.43 for the 1-hour film.
- **Live container encode.** Needs the Workers Paid plan at $5 a month. Not enabled, so the encode line stays at the measured floor plus extrapolation.
- **DRM.** No vendor account, no player, no license counting. The 2 licenses per play and the $0.005 to $0.02 band are the proposal's assumptions carried forward unchanged. A brief look at public vendor price pages was started and then stopped at your request; it is not part of this result.

**Left on the account after the test:** one bucket `ztor-5b-test` with 93 objects (1.756 GB) and its r2.dev URL enabled, plus one R2 API token scoped to that bucket. All free to keep. The token should be deleted regardless since its secret was pasted in chat.

## Rerunning

```
cd test
docker build -t ztor-encoder .
docker run --rm --cpuset-cpus=0-3 --memory=7g \
  -v /path/to/master.mov:/src/master.mov:ro -v "$PWD/out:/out" \
  ztor-encoder /work/encode.sh /src/master.mov /out 1     # last arg 0 skips the 4K timing pass
docker run --rm -v "$PWD/out:/out" ztor-encoder /work/package.sh /out/renditions /out/packaged
python3 costmodel.py out
```

Files: `Dockerfile`, `encode.sh`, `package.sh`, `costmodel.py`, `out/timing/`, `out/packaged/timing/inventory.csv`, `out/costmodel_output.txt`.
