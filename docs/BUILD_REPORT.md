# Option 5B build report

Date: 2026-09-21. Scope: the proposal `ztor-5b-streaming-proposal.html`, built step by step per `BUILD_PLAN.md`, on the user's own Cloudflare account (Free plan) plus an Axinom Mosaic DRM trial. Companion documents: `test/REPORT.md` (pricing test and measurements), `BUILD_PLAN.md` (plan and dated progress log).

## 1. Verdict in four lines

- **Buildable:** every step of section 4 that does not require a paid Cloudflare plan or Apple is built, running and verified, including real multi-DRM licenses from Axinom.
- **Cheap on Cloudflare:** the whole project, three films, ~35,000 requests, ~10 GB stored, 5,600 Worker requests, sat inside the free tiers. Cloudflare billed **$0** (every meter inside its free allowance; the invoice page itself needs the dashboard). At list price the same usage would have been about **$0.04**.
- **Confirmed at the plan's own DRM price:** $13–49 per film against the plan's $12–43, with Cloudflare at $2.6–8.7 of it. DRM remains the line that sets the per-view price, as the plan said; vendors' published plans are discussed in section 1b (claims 8 and 9), not in the cost table.
- **Four proposal statements need correction** (section 5), the most important being that cbcs does not play in desktop Chrome's Widevine, so each film's segments must be packaged twice, in two encryption modes, with the same keys (section 3.6).

## 1b. The plan's claims, scored on the plan's own terms

Each statement the proposal makes, taken with the assumptions the proposal itself states (DRM at $0.005–0.02 per licence, base fees excluded and shared across the catalogue), and the measurement that tests it.

| # | Plan statement | Plan's own assumption | Measured | Score |
|---|---|---|---|---|
| 1 | Delivery is $0 on Cloudflare | R2 egress free | 1.07 GB and later ~3 GB served, $0 on the meter | **True** |
| 2 | Cloudflare's share is ~$1.7–2.7 per 1-hour 4K film, 1,000 views | 30 GB stored, 3–5 h encode, ≤600k reads | $2.6–8.7; encode and reads higher, delivery same | **Partly true**: right order of magnitude, low by 1.5–3x |
| 3 | Per view $0.01–0.04 | 2 licences × $0.005–0.02, base fee excluded | 1–3 licences per play measured → $0.005–0.06 per view at the plan's own licence prices | **True on its terms**; the terms hide the base fee (see 8) |
| 4 | Encode ~3–5 h, ~$1–2 | 4 vCPU Container | 3.8x realtime on 4 fast cores → 6–8 h, $2.30–3.20 on Containers | **False**, about 2x low |
| 5 | ~30 GB stored per film | master + renditions | 12 GB renditions measured; master 7 GB (H.264) to 300 GB (ProRes); ×2 renditions if dual packaging | **Unstated assumption**; true only with a compressed master |
| 6 | ≤600,000 cache-miss reads per 1,000 views | video segments | 1.2 M (audio segments too), $0.44 uncached, $0.02 at 95% hit | **False**, 2x low, cost still cents |
| 7 | 2 licences per play | video key + audio key | Widevine 1, FairPlay 2–3 | **Partly true**: right average, wrong as a constant |
| 8 | DRM $10–40 per film | per-licence pricing exists at entry level | vendors sell monthly plans, $200–500 with 10k–20k licences included | **False as a per-film cost**; true as marginal cost once the plan is used up |
| 9 | $0.005 per licence achievable | volume contract before launch | no published price below ~$0.015; unverifiable without a quote | **Unverified** |
| 10 | cbcs works for FairPlay, Widevine and PlayReady | one packaging | FairPlay yes; desktop Chrome Widevine refused cbcs, cenc played | **False for desktop Chrome**; two modes needed |
| 11 | One video key + one audio key, HDCP required for 2160p | step 6 + step 8 | a single video key cannot be withheld per rung; three keys built and working | **Internally contradictory**; fixed with a third key |
| 12 | It is allowed: CDN may serve video hosted on R2 | Cloudflare terms | terms name "the Developer Platform, Images, and Stream"; R2 is in the Developer Platform | **True**, wording should quote the terms |
| 13 | Bunny works in days, 5B takes weeks | build effort | Phase A took ~2 days of build on the free tier for one engineer plus the tooling; Phase B items are gated by accounts, not code | **Plausible**, not measured against Bunny |
| 14 | AWS $447–477, Google $344–374, Bunny $136+ per film | list prices | not tested; arithmetic is per-GB list price × 3.6 TB | **Unverified here** |
| 15 | Break-even vs Bunny at 1–3 films a month | Bunny also charges a $99 DRM fee | fixed floor $214–514 at list; the comparison depends entirely on the DRM plan chosen, not on Cloudflare | **Unverified**; the Cloudflare side of the claim is true |

**Summary on the plan's terms:** the Cloudflare claims (1, 2, 3, 12) hold, with two lines low by a factor of two (4, 6). The DRM claims (7, 8, 9) are where the plan's terms and the market differ: the per-view number is right as marginal cost and misleading as a launch cost. Two technical statements (10, 11) are wrong and were corrected in the build.

## 2. Step-by-step match against section 4

| Step | Proposal | Built | Verified how | Matches? |
|---|---|---|---|---|
| 1 Open the accounts | Cloudflare Workers Paid, DRM vendor, Apple FairPlay request | Cloudflare **Free** plan; **Axinom Mosaic trial** with DRM Service (Widevine, PlayReady, FairPlay evaluation certificate); Apple not started | vendor licenses issued (D1 log, upstream 200) | Partial: no Workers Paid, no Apple |
| 2 Two storage boxes | `ztor-masters` private, `ztor-streams` behind custom domain, cache rules | Both buckets; masters never public; streams served by the Worker on workers.dev, so every segment is one Worker request plus one R2 read with no edge cache (about 82 full 1-hour views a day on the Free plan's 100k requests); no custom domain, no cache rules | curl: masters unreachable; segments served with 1-year immutable header | Partial: domain missing (needs a zone) |
| 3 Creator upload | Worker issues presigned multipart URLs, D1 film record, 2 GB test | `POST /uploads` + `/complete`, aws4 presigned parts, D1 `films`; 2.096 GB file uploaded in 20 parts | ETag match, status `uploaded`, 4 masters uploaded this way | **Yes** |
| 4 Ring a bell | R2 event notification → Queue → consumer → Workflow, idempotent | Completion starts the Workflow directly; queue consumer written and dormant (`src/queue.ts`) because Queues need Workers Paid | every upload reached `queued` within 1 s; requeue idempotent | Partial: same behaviour, different trigger |
| 5 Video machine | Container (standard-4) with ffmpeg + Shaka Packager, POST /encode, presigned URLs only, H.264 ladder, cbcs, upload to streams | Same image, runs on this Mac in poll mode (Containers need Workers Paid); ladder 2160p→360p + AAC; no R2 binding; outputs versioned `films/{id}/v{n}/` | 12 successful jobs; 18-min 4K film: 3.8x realtime on 4 cores; duration guard catches truncated reads | Partial: local, not Cloudflare |
| 6 Locks from the DRM vendor | Vendor CPIX keys, key IDs only in D1, raw keys never stored, keys to container over HTTPS | Keys generated in the Workflow (3 per film: SD/HD, UHD, audio + IV), **passed inline to Axinom** in the signed entitlement; raw keys in Worker KV | Axinom accepts inline keys (licenses issued) | Partial: inline keys instead of vendor CPIX; KV holds raw keys (to remove in production) |
| 7 Check the ticket | `/play` JWT 4 h, 402 without rental, token-gated manifests, public encrypted segments | As specified, plus device capability claim and policy in the response; HLS master and DASH manifest both filtered by policy server-side | console checks 1–4, headless and manual | **Yes** |
| 8 Guard the key door | `/license/{widevine,fairplay,playready}` → vendor, JWT required, 10/min, 48 h / no offline / HDCP for 2160p, one D1 row per license | All three routes proxy to Axinom with a signed License Service Message; ClearKey route returns 410 while a vendor is configured; D1 row with upstream status and vendor error text | Axinom: valid signature accepted, tampered refused; real licenses issued; 429 after 10 | **Yes** |
| 9 Hook up the players | Shaka web (DASH+Widevine, HLS+FairPlay), iOS AVPlayer, Android Media3, "up to 1080p" message | Web console with browser-based key-system choice; **Safari plays both trailers via FairPlay**; Chrome plays cenc via Widevine, refuses cbcs; native apps not built | user sign-off in Safari; D1 license log | Partial: web only; Chrome needs cenc packaging |
| 10 Free content on Stream | Stream upload path | Not built (out of scope by decision; Stream is paid) | | No |
| 11 Test before launch | 1-hour 4K encode timing, screen-record test, 4-city start time, invoice match | 18-min 4K timing done; console runs 7 security checks; no device screen-record test, no remote probes, no invoice yet | | Partial |
| 12 Launch | founding creators, weekly meters | Not in scope; meters exist in D1 (licenses per play, encode minutes) | | No |

**Built that the proposal did not ask for, all needed to make it work:** versioned output paths (immutable caching + re-encodes), duration guard on encodes, per-tier keys (SD/HD, UHD, audio), per-rendition FairPlay key URIs with IV, server-side playlist filtering by policy, a test console with one-click security checks, a DRM capability probe.

## 3. Plan versus actual: what one 4K film costs

One 1-hour 4K film, watched 1,000 times in a month. DRM is priced exactly as the plan prices it: 2 licences per play at $0.005–0.02, base fee excluded. Everything else is measured on the build or recomputed from what is in R2.

| | Per film per month | Per view |
|---|---|---|
| Plan | $12–43 | $0.01–0.04 |
| Actual | $13–49 | $0.013–0.049 |
| of which Cloudflare | $2.6–8.7 | $0.003–0.009 |

### 3.1 Line by line

| Line | Plan | Actual | Why different |
|---|---|---|---|
| Encode, once | $1–2 | $2.30–3.20 | measured 3.8x realtime; 6–8 h on a 4-vCPU Container |
| Storage, per month | $0.45 | $0.28–5.13 | 12 GB of renditions measured; the master is 7 GB (H.264) or 300 GB (ProRes); the plan did not say which |
| Saving files, once | $0.02 | $0.02–0.05 | same |
| Delivery, 1,000 views | $0 | $0 | confirmed on the meter |
| Cache misses, 1,000 views | $0.22 | $0.02–0.44 | audio segments were not counted; $0.02 with a cache, $0.44 without |
| Packaging, access checks, players | $0 | $0 | same |
| **Cloudflare total** | **$1.7–2.7** | **$2.6–8.7** | right shape, two lines about 2x low |
| DRM, 2,000 licences | $10–40 | $10–40 | held at the plan's price; measured 1–3 licences per play would make it $5–60 |
| **Total, one film** | **$12–43** | **$13–49** | within $1–6 of the plan |
| **Per view** | **$0.01–0.04** | **$0.013–0.049** | plan confirmed at its own DRM price |

### 3.2 Monthly fees for the whole platform

| Item | Plan | Actual | Paid so far |
|---|---|---|---|
| Workers Paid plan | $5 | $5 | $0, Free plan |
| DRM vendor base fee | $99–200+ | $99–200+, held at the plan's figure | $0, trial |
| Cloudflare zone plan | $0–200 | $0 | $0 |
| Apple FairPlay | $0 | $99 / year Apple Developer Program | $0 |
| **Total** | **$104–405** | **$112–213** | **$0** |

**Billed for this whole project so far: $0.** Every Cloudflare meter stayed inside its free allowance (2,879 writes, 33,135 reads, under 1 GB-month stored, 5,643 Worker requests); the same usage at list price would be about $0.04. Axinom and Apple: $0.

**In one sentence:** at the plan's own DRM price the plan is confirmed, $13–49 per film against $12–43, with Cloudflare at $2.6–8.7 of it; the two lines to correct are encode (about 2x) and storage (state the master format).

### 3.6 Keys and encryption modes, stated plainly

This is the point most likely to be misread, so here it is without shorthand.

- **Keys per film: three, shared by every browser and device.** One for the rungs up to 1080p, one for the 2160p rung, one for audio. Chrome and Safari receive the *same* keys; there is no separate Chrome key or Safari key. The proposal specified two (one video, one audio); the third exists so the 2160p key can be withheld from devices without HDCP.
- **Encryption modes: two, because the DRM systems disagree.** Each segment is encrypted once per mode with the same key: **cenc** for the DASH set that Widevine and PlayReady play (Chrome, Edge, Firefox, Android), **cbcs** for the HLS set that FairPlay plays (Safari, iPhone, iPad). Desktop Chrome's Widevine refused cbcs in this test, and FairPlay accepts only cbcs, so no single mode reaches both.
- **What that costs:** encoding runs once; packaging runs twice, about 0.1–2 minutes per film; segment storage doubles, about 12 GB → 24 GB per 1-hour 4K film, roughly $0.18 more per month per film; the licence server is unchanged because keys do not depend on the mode.
- **Status in this build:** the three-key layout is live. Dual packaging is designed and costed but **not yet implemented**; today the trailers are cbcs only, which is why Safari plays them and desktop Chrome does not. The 18-minute test film is cenc only, the reverse.

### 3.7 Protected URL versus DRM, side by side (added 2026-09-24)

At the user's request one film, the SPL2 trailer (v6), now exists in two versions from the same encode: the DRM version (encrypted, key from Axinom) and a protected-URL version (the same renditions packaged clear, every manifest and segment link signed with the 4-hour pass). Measured on this build:

| | DRM version | Protected-URL version |
|---|---|---|
| What stops a stranger | Segments are public but encrypted; the key only arrives inside a vendor license bound to the device | Every file needs a pass for this film and this version; links expire with the pass (4 h) |
| What stops the paying viewer from keeping the film | The decrypted picture never leaves the device's DRM module | Nothing: with a valid link the segment downloads and decodes offline to a full picture (verified, no key needed) |
| Browsers on this Mac | Safari (FairPlay) for cbcs films; Chrome and Edge (Widevine) for cenc films; the HDCP box matters | Chrome and Edge play it at 1080p with zero license requests, first frame in 1.5 s; Safari plays clear HLS natively |
| 4K | Allowed with HDCP and hardware DRM | Capped at 1080p, because there is no HDCP without DRM |
| Per-view cost | Vendor license fee, the whole per-view headline of the proposal | $0 beyond delivery |
| Storage | one copy | a second copy of the streaming files (about +100 MB for this trailer, roughly double for any film) |
| CDN caching | segments cache per URL | segment URLs differ per viewer, so a shared edge cache needs a rule that ignores the token (Phase B, custom domain) |

The console's checks 8 and 9 make the point on demand: a URL segment is refused without its pass and refused with a DRM pass, and with the right pass it is clear and saveable.

## 4. Things measured that the proposal assumed

| Assumption | Measured |
|---|---|
| 2 licenses per play | 1 (Widevine) to 3 (FairPlay with UHD) |
| ~8 Mbps average view | 5.8 Mbps at 1080p, 15.4 Mbps at 2160p |
| 30 GB stored per film | 12 GB renditions + master (20 GB H.264 or 300 GB ProRes); 24 GB renditions with dual packaging |
| 3–5 h encode | 3.8x realtime locally → 6–8 h on Containers |
| ≤600k reads per 1,000 views | 1.2M (audio segments count too) |
| cbcs works everywhere | FairPlay yes; desktop Chrome Widevine no (this Mac) |

## 5. Corrections to the proposal text

1. **Step 5:** "encryption cbcs (works for FairPlay, Widevine and PlayReady)" → the same three keys, but two encryption modes and therefore two segment sets: cbcs for HLS/FairPlay, cenc for DASH/Widevine/PlayReady. Not two keys. Segment storage doubles (see 3.6).
2. **Step 5:** add `--generate_static_live_mpd`, `--clear_lead 0`, per-rendition `skd://<key id GUID>:<IV>` key URIs, output duration check against the source, versioned output paths.
3. **Step 6:** one video key + one audio key → one key per security tier (SD/HD, UHD) plus audio, or the step 8 HDCP policy cannot be enforced.
4. **Section 2:** 2 licenses per play → 1 to 3 depending on DRM system; $0.005 per license is a negotiation target, no vendor publishes it.
5. **Section 2:** storage 30 GB → state the master format; ProRes masters are 10x larger.
6. **Step 7/9:** Safari's native HLS player cannot send headers and ignores client restrictions; carry the pass in the playlist URLs and enforce resolution policy in both the HLS master and the DASH manifest server-side.

## 6. What is not done, and its price

| Item | Why not | Cost to do |
|---|---|---|
| Encoder on Cloudflare Containers, Queues, event notifications | Workers Paid | $5 / month |
| Custom domain, cache rules, WAF, cache hit-rate measurement | no zone on the account | $0 owned domain or about $10 / year |
| Dual packaging (cenc + cbcs) | deferred by the user | about 1 hour of work, $0 |
| Apple production FairPlay certificate | needs Apple Developer Program and approval | $99 / year, days to weeks |
| Vendor CPIX keys instead of inline keys; remove raw keys from KV | production hardening | $0 |
| iOS and Android players | needs Xcode, Android Studio, devices | $0 in services |
| Screen-record test, 4-city start-time test, invoice reconciliation | devices and people elsewhere; one billing cycle | |
| Stream for free content | out of scope | $5 / month minimum when used |

## 7. How to test it yourself

Console: `https://ztor-video.mluthfi840.workers.dev/player`. The console asks once for the test key held by the operator; the `/test/*` routes that grant rentals refuse requests without it, and the entitlement debug route was removed after the independent audit flagged both as open. Pick a film, type a viewer id, Rent, Play. "Run all checks" runs the seven security checks. The log shows the key system, the license response (opaque with Axinom), key statuses and buffering. Chrome plays the cenc film; Safari plays the cbcs trailers via FairPlay. Test-mode routes (`/test/*`) are gated by `TEST_MODE=true` in `ztor-video/wrangler.jsonc`; set it to `false` before exposing the Worker to real users.

Code: `ztor-video/` (Worker, Workflow, DRM adapter, console), `ztor-video/encoder/` (Docker image), `test/` (pricing test scripts and report).

## 8. Watch party (added 2026-09-24)

Asked for: a "watch party" where one host plays a film, turns on camera and microphone, reads chat and pins comments, built on Cloudflare instead of LiveKit because LiveKit's per-participant pricing was the problem. Decisions taken with the user before building: the film plays as **synchronized playback of the protected-URL version** (each viewer's own 4-hour pass from R2, capped at 1080p, no DRM, no license calls) and only the host's camera, microphone and screen travel over WebRTC; **raw Realtime SFU**, not RealtimeKit; **no Cloudflare Stream**; start small on the Free plan. Nothing in the existing console or its routes changed; everything is additive (migration 0005, `src/party.ts`, `src/party-routes.ts`, `src/sfu.ts`, `public/party.html` at `/watch`).

### 8.1 What LiveKit did, and what does it now

| LiveKit piece | Here | Status |
|---|---|---|
| SFU, publish and subscribe tracks | Cloudflare Realtime SFU, one app, sessions minted by the Worker (secret never reaches the browser) | Live |
| Room, join token, roles | `PartyRoom` Durable Object (SQLite class, Free plan) + a party ticket: the film's url-mode pass with `party` and `role` claims | Live |
| Data channels for chat and sync | WebSocket to the Durable Object (Hibernation API; keepalive answered without waking it) | Live |
| Mute, kick, permissions | Durable Object state: mute list, ban list (kick closes the socket with 4001, rejoin gets 403), host-only clock, slow mode | Live |
| Recording, HLS out | Not built (would be Stream Live, paid; user declined) | No |
| TURN | Wired (`TURN_KEY_ID` + `TURN_KEY_API_TOKEN`), no key created yet, so STUN only | Optional |
| Simulcast (LiveKit: automatic in the SDK) | Host sends three layers per video track (a full, b half, c quarter); viewers ask for a with `priorityOrdering: asciibetical`, so the SFU steps them down when their bandwidth is short; a viewer loop steps down at >5% loss and back up after 30 s clean through `PUT /party/{id}/rtc/layer` | Live (added later on 2026-09-24) |

The playback clock is `{state, position, rate, at}` stamped with the room's time; viewers keep an NTP-style offset (three `time` round trips at connect), seek when more than 2 s off, and otherwise nudge playback rate by 5%. Chat and host actions are written to D1 in one batch per 3-second tick, not per message. Every host publish group (camera + mic, screen + its audio) is its own SFU session and PeerConnection on both sides; stopping a group closes its connection and restarting opens a fresh session. When no host socket is connected the room retracts the host's tracks so viewers drop dead sessions.

### 8.2 Measured (headless Chrome 153 on this Mac, fake camera, real SFU)

| Item | Measured |
|---|---|
| Host camera 1280x720 at 19 fps, egress per viewer | 694 kbps (cap set at 1.2 Mbps) |
| Host camera 640x360 | 360–377 kbps |
| Camera + 720p screen share, one viewer | 755 kbps total |
| Host feed visible at a viewer after publish | about 1 s (publish 07:17:20, viewer receiving 07:17:21) |
| Camera stop -> viewer tile hidden; restart -> back | 1–3 s; 1 s |
| Film sync while playing (viewer minus host) | -0.06 to +0.12 s |
| Pause follows | viewer paused, 0.0 to +0.45 s from the host's position |
| Late joiner | gets the last 50 messages, the pin, the clock and the live tracks in the `hello` frame |
| Realtime meter today (all test runs) | 12.6 MB egress, 10.1 MB ingress, 30 sessions, $0 |
| Worker / Durable Object requests today | 3,021 / 510, inside the free 100,000 per day |
| Simulcast layers leaving the host (720p camera) | a 1280x720 at 0.75–1.2 Mbps, b 640x360 at 0.4 Mbps, c 320x180 at 0.15 Mbps; about 1.3–1.75 Mbps upload in total |
| Viewer layer switch, requested through the Worker | down a -> c -> b: picture changes within 7 s; up b -> a: 10–20 s (the SFU ramps bandwidth before sending the larger layer) |
| Security checks on the host page | 6 of 6 PASS: join without rental 402; viewer clock refused; viewer publish 403; ticket on another film 401; chat burst 1 accepted 3 refused; kicked socket 4001 and rejoin 403 |

### 8.3 What a party costs

| Line | Per viewer-hour | 100 viewers, 1 h | 1,000 viewers, 1 h |
|---|---|---|---|
| Host camera at the measured 0.7 Mbps | 0.32 GB | 32 GB | 320 GB |
| Host camera at the 1.2 Mbps cap | 0.54 GB | 54 GB | 540 GB |
| Camera + screen at the 2.5 Mbps cap | 1.7 GB | 170 GB | 1,700 GB |
| Viewer on a weak connection, stepped down to layer b or c | 0.18 or 0.07 GB | less | less |
| Realtime price | first 1,000 GB a month free, then $0.05 per GB | $0 | $0 to $35 |
| Film delivery (R2 through the Worker) | $0 egress, about 1,200 Worker requests per hour watched | $0 | Free plan's 100,000 requests a day are gone in the first hour: Workers Paid, $5 a month + $0.30 per extra million |
| Durable Object | incoming WebSocket messages count 20:1; 10 chat lines per viewer is 500 requests | $0 | $0 |

In short: a party of tens or a hundred costs nothing on top of the film. A thousand-viewer party costs a few dollars of Realtime egress once the monthly free terabyte is used, and it needs the Workers Paid plan for the film segments, the same $5 that Phase B already lists. Pushing the film itself through the SFU instead would have cost about 2.6 GB per viewer-hour at 1080p, which is why it was not done.

### 8.4 Two things learned about the SFU

1. **Do not renegotiate a live PeerConnection to close tracks.** Following the documented close recipe (transceiver inactive, offer, `tracks/close`, apply the answer) made Chrome reject the SFU's answer with "RTP extension ID reassignment not supported": the answer renumbers header extensions on the now-inactive media line. A forced close without renegotiation then left later publishes on the same connection unable to deliver packets (`empty_track_error` for good). The per-group connection design above avoids renegotiation on live connections entirely.
2. **A pull can arrive before the publisher's first packets.** The room announces tracks as soon as the publish call returns; a viewer pulling within that window gets `empty_track_error`. Viewers retry with backoff (0.8 s, 1.5 s, 2.2 s, ...).

### 8.5 Not done

| Item | Why | Cost to do |
|---|---|---|
| TURN key | not needed on this network; viewers behind strict NATs would fail to connect with STUN only | $0, dashboard, counts against the same free 1,000 GB |
| Safari, iOS, Android, phone layout | only Chrome tested headless; the page is responsive but unverified on phones | devices and time |
| Real login | host and viewer ids are the same stub the console uses | product work |
| Recording or HLS out for people outside the room | needs Stream Live | $1 per 1,000 minutes delivered |
| Workers Paid + custom domain | only when parties go past a few hundred viewers | $5 a month + a domain |

### 8.6 How to test it

Open `https://ztor-video.mluthfi840.workers.dev/watch`, rent the SPL2 trailer as the host, create a party, open the link it prints in a second browser as a viewer (rent there too, the button is on the page). Host: press Camera, Share screen, play the film. Viewer: tap once to allow sound, then watch it follow. "Run all checks" on the host page runs the six security checks with a throwaway viewer. Scripts used for the measurements are in `ztor-video/scripts/party/` (`party-test.mjs` needs only Node 22+; the browser tests need `npm i playwright` and Google Chrome).

## 9. Accounts, roles and the new app (added 2026-09-24)

Asked for: a friendlier interface for films and parties that keeps the logs, real login, and three roles (admin, host, user) with admin limited to one screen that changes roles. Decisions: open signup; hosts run parties only, they do not upload films; the dark orange look stays; the old console at `/player` stays untouched.

### 9.1 What was built

| Piece | Where | Notes |
|---|---|---|
| Accounts | `src/auth.ts`, migration 0006 (`users`, `sessions`) | email + password, PBKDF2-SHA256 at 100,000 iterations (the Workers cap), 16-byte salt, constant-time compare; login hashes even for unknown emails so timing does not reveal accounts |
| Sessions | HttpOnly, Secure, SameSite=Lax cookie; D1 row holds the SHA-256 of the cookie value; 30 days | one D1 read per request |
| Roles | `admin`, `host`, `user`; the first account ever registered is admin; only admins change roles; the last admin cannot be demoted | enforced in the Worker, not only hidden in the page |
| App | `public/app.html` at `/app`, one file, hash routes: login, home, watch, party, admin | same Shaka player and the same party runtime (per-group SFU sessions, simulcast, sync, chat) as before, with a Details drawer holding the log and, for hosts, the six security checks |
| API for the app | `src/app-routes.ts`: films with rental state, rent (free, 48 h), live parties, admin user list and role change | all behind the session |
| Existing routes | `/play`, `/party` create and join now read the user from the session; in TEST_MODE the legacy console's typed id is still honoured so the seven original checks and `/watch` keep working | `TEST_MODE=false` before launch turns the stub off |
| Room | chat messages and the pinned comment carry the display name; kicks are still by user id | `x-party-name` header into the Durable Object |

### 9.2 Verified (headless Chrome, three fresh accounts)

| Check | Result |
|---|---|
| First account registers | admin; second and third are `user` |
| Wrong password, duplicate email | 401, 409 |
| A `user` creates a party, lists users | 403, 403 |
| Admin sets a user to `host` from the Admin screen; demoting the last admin | applied; 409 |
| The new host creates a party from Home, turns the camera on | published with simulcast a/b/c |
| A `user` opens the party link without a rental | rent-and-join screen, then joins as viewer and receives the host's camera |
| Chat and pin | show display names, not ids |
| Film sync | viewer within 0.16 s of the host |
| Home | Live now card shows LIVE, host name and 2 watching |
| End party | everyone notified, host returned home |
| Legacy console and Node room test | unchanged, still pass |

### 9.3 Not done

| Item | Why | Cost |
|---|---|---|
| Password reset, email verification | needs an email sender | a mail API, cents |
| Login rate limiting or lockout | not built; PBKDF2 already makes brute force slow | small |
| Payment for rentals | out of scope; Rent is a free 48 h button | product decision |
| Film upload from the app | hosts do not upload by decision; creators still use the presigned upload routes | small UI |
| Retiring `/player` and `/watch` | kept on purpose until told otherwise | delete two files |

### 9.4 How to use it

Open `https://ztor-video.mluthfi840.workers.dev/app`. The test accounts were deleted after the run, so the first person to register becomes the admin. Register, then under Admin set your second account to `host`. The host rents a film, presses Host a party, turns on Camera. Anyone else registers, opens the party from Home, rents when asked, and watches.

## 10. Correction: desktop Chrome does play cbcs (added 2026-09-24, evening)

The user reported that only one film played in Chrome and Edge. Tested in the real Chrome 153 binary with its Widevine module (headless, driven over the debugging protocol, because Playwright's own Chrome has no Widevine):

| Film | Encryption | Plain Shaka player | App and console before the fix | After the fix |
|---|---|---|---|---|
| SPL2 trailer v6 | cbcs | plays | Shaka 6001, empty data | plays 1080p |
| Vulgaria 4K upscale v9 | cbcs | plays | Shaka 6001 | plays |
| Vulgaria x9 v1 | cenc | plays | plays | plays 1080p |

**Cause.** Chrome 153 decrypts cbcs with Widevine: its key-system probe, its media-capabilities check and playback all agree. The 6001 came from our pages: after `shaka.polyfill.installAll()`, Shaka queried Chrome only about PlayReady for the cbcs manifests, never Widevine, and Chrome has no PlayReady. The fix is one line in each page: `drm.preferredKeySystems` = Widevine then PlayReady on Chromium, FairPlay on Safari. The old console got the same line, since it had the same fault.

**What this changes in this report.** Sections 1, 1b (claim 10), 3.6 and 5 say desktop Chrome refused cbcs and that every film therefore needs two packagings. That conclusion came from the same page and the same polyfill, not from Chrome. Dual packaging (cenc + cbcs) is no longer required for Chrome; it remains a choice for older Chromium builds and for PlayReady devices, which is a smaller population. The per-film storage estimate in 3.6 (segments doubled) can be halved back for the Chrome case.

**Still open: the HDCP box.** With HDCP unticked, every DRM film fails in Chrome with 6007 <- Axinom 403 "key ID not present in the entitlement", because the licence message omits the 2160p key while Chrome's Widevine asks for every key in the manifest. This is the failure a viewer without HDCP would hit on a 4K film. The proposed fix is to always include the 2160p key and let the licence's UHD policy (hardware security + HDCP 2.2) decide whether the device may use it; not applied yet, awaiting the user's decision, since it changes how security check 7 is enforced.

## 11. Party tickets (added 2026-09-25)

Asked for: viewers join a party with a **ticket**, a different thing from renting the film, and a viewer who owns a rental must still buy a ticket.

| Right | What it gives | Where it is checked |
|---|---|---|
| Rental | the film for 48 h, on the Watch page, DRM or protected-URL | `/play` |
| Ticket | one party: the film inside that party only, in sync with the host, while it runs | `/party/{id}/join`; the party pass it produces is bound to the party and the film, expires in 4 h, and `/play` still refuses a ticket holder who has no rental |
| Host | rents the film (they are screening it) and needs no ticket | `/party` create, `/party/{id}/join` |

Built: migration 0007 `party_tickets` (party, user, source, price), `POST /party/{id}/ticket` (free until there is a payment step; refused once the party has ended), join now requires a ticket for every viewer (a rental no longer substitutes), Home cards show "Get ticket" then "Join", the party link without a ticket shows a "Get a ticket and join" screen, the host's security check 1 became "join without a ticket is refused". Verified headless: rental without ticket 402, ticket then join 200, ticket holder `/play` 402, unknown party 404, host without ticket joins, chat, camera and sync unchanged.

Not built: a price and a payment step (the table has the columns), host invitations by name, refunds or ticket revocation (an admin can delete the row).

## 12. The 4K rule, loosened to "medium" (added 2026-09-25)

The user's phone and Chrome on the Mac showed no 2160p option. Measured: the manifest carries 2160p, the pass allows 2160p, but the licence did not deliver the 2160p key, because the UHD usage policy required hardware DRM **and** HDCP 2.2, and neither device satisfied both (Chrome on a Mac is Widevine L3; the phone failed one of the two). The app now shows such a rung inside the quality selector as a disabled entry with the reason ("2160p locked: key not delivered (DRM level or HDCP)" / "this device cannot decode it") and logs the key status, the decoder check and the device's DRM level.

Decision (user): **medium**, for all films. The 2160p key now requires DRM in hardware (Widevine `HW_SECURE_ALL`, PlayReady SL3000, FairPlay) and no HDCP level. Consequences:

| | Before | After |
|---|---|---|
| Who gets 4K | hardware DRM with HDCP 2.2 | any hardware DRM: most Android phones and TVs, Apple devices, Safari on Macs |
| Chrome and Edge on laptops | 1080p | 1080p (software Widevine) |
| HDCP box in the pages | gated whether the 2160p key was entitled | removed from the app; the key is always entitled, the device decides |
| "HDCP off -> Axinom 403 for every film" (section 10) | open | gone: the entitlement always lists every key Widevine asks for |
| Console check 7 | "4K key withheld without HDCP" | "4K key entitled regardless; hardware DRM decides" |
| Proposal step 8 wording | HDCP required for 2160p | hardware DRM required for 2160p; HDCP not enforced |

Verified in real Chrome 153 (L3): all three DRM films play at 1080p with the 2160p entry shown as locked "key not delivered"; no more failures from the old HDCP-off path. Whether the user's phone receives the 2160p key under the new rule depends on its Widevine level (L1 yes, L3 no); the selector will say.

**Update, later on 2026-09-25: rule set to "open".** Under "medium" the user's phone still showed "2160p locked: key not delivered", so its Widevine is software as well. The user needs 4K on these devices, so the UHD usage policy now has the same requirements as the other keys (Widevine `SW_SECURE_CRYPTO`, PlayReady 150, FairPlay no HDCP, AirPlay and adapters allowed). Verified in Chrome on the Mac: both 4K films now offer and play 2160p (3840x2160 at 18 to 19 Mbps). The trade-off is stated plainly: a software DRM can be captured by a screen recorder, so licensed 4K titles would normally not be released this way. The medium and strict values are kept as a comment in `src/drm-vendor.ts` for when a licensor requires them, and a per-film switch remains possible.

## 13. Smooth manual quality switch (added 2026-10-01)

The user reported that choosing a resolution in the quality selector paused the picture first. Cause: both pages called Shaka's `selectVariantTrack(track, true)` with no safe margin, which throws away everything buffered ahead of the playhead; the picture then waits for a whole 6-second segment of the new rung to download. Fix: keep one segment (6 s, the packager's `--segment_duration`) and replace the rest, `selectVariantTrack(track, true, 6)`, in `public/app.html` and `public/index.html`. Measured headless (real Chrome, protected-URL trailer, 360p -> 1080p forced while playing with 10 s buffered, each line run 2 to 4 times):

| Call | Picture frozen | `waiting` events | New rung on screen after |
|---|---|---|---|
| `(t, true)`, before | 1.4 to 2.7 s | 1 | 1.7 to 2.8 s |
| `(t, true, 3)` | 1.0 to 1.25 s | 0 | 4.9 s |
| `(t, true, 6)`, chosen | 0 | 0 | 3.6 to 4.0 s |
| `(t, false)` | 0 | 0 | 10.0 s (plays out the old buffer) |

A margin of one segment asks the connection for roughly the rung's own bitrate during the switch, the same as sustained playback of that rung, so it adds no requirement that playing the rung does not already have. The party player is untouched: viewers there are on ABR and have no selector. Deployed the same day (version 92d92cdc) and re-measured on the live page: 5 of 6 runs identical to the table, 0 s frozen and 1080p on screen after 4.0 s; one run showed a 10 s stall with no `waiting` event and the new rung never arriving, not reproduced in four further runs, so most likely a one-off in the headless tab rather than the switch logic.
