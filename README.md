# ztor-video

Film streaming on Cloudflare with no origin server. One Worker handles creator uploads, encoding jobs, rentals, play passes, DRM licenses, a viewer app with accounts and roles, and synchronized watch parties where the host's camera and voice travel over WebRTC while every viewer streams the film from storage.

It was built to test a cost proposal ("Option 5B": R2 storage plus a DRM vendor instead of a video platform) on a free Cloudflare account. The documents in [docs/](docs/) record every decision and measurement; this file explains how the code is laid out and how to run it.

## What it does

| Area | What a user gets | Where |
|---|---|---|
| Upload | A creator uploads a master in presigned multipart parts straight into a private R2 bucket. Completion starts the encode pipeline. | `src/routes/uploads.ts`, `scripts/upload-client.py` |
| Encode | A Workflow waits for the encoder. The encoder is a Docker image (ffmpeg plus Shaka Packager) that polls the Worker for jobs, builds an H.264 ladder from 2160p down to 360p, encrypts with three keys (SD/HD video, 2160p video, audio) and uploads versioned HLS and DASH output. A clear "protected-URL" version can be packaged alongside. | `src/encode/`, `src/routes/runner.ts`, `encoder/` |
| Rent and play | A viewer rents a film, then asks for a 4-hour pass. The pass is a JWT that unlocks the manifests; the Worker filters the manifest to the heights the pass allows. DRM segments are public but encrypted. Protected-URL segments are clear but every link carries the pass. | `src/routes/play.ts`, `src/routes/media.ts`, `src/lib/jwt.ts` |
| DRM | Widevine, PlayReady and FairPlay licenses are proxied to Axinom with a signed entitlement that carries the film's keys. ClearKey exists for the no-vendor path and is closed while a vendor is configured. | `src/routes/license.ts`, `src/lib/drm-vendor.ts` |
| Accounts | Email and password, PBKDF2 hashing, HttpOnly session cookie, three roles: `admin`, `host`, `user`. The first account registered is the admin. | `src/lib/auth.ts`, `src/routes/app.ts` |
| Watch party | A host screens a film. Viewers buy a party ticket, join a room, chat, and follow the host's playback clock. The host's camera and microphone go through Cloudflare's Realtime SFU with simulcast; the film never does. | `src/party/`, `src/lib/sfu.ts` |
| Pages | `/app` is the product: login, home, watch, party, admin. `/player` is the original test console with the seven security checks. `/watch` is the first party page, kept for its tests. | `public/` |

## How the pieces fit

```
browser ──HTTPS──▶ Worker (src/index.ts)
                    ├─ D1          films, keys, rentals, licenses, users, sessions, parties, tickets
                    ├─ R2          ztor-masters (private)  ztor-streams (served through /media)
                    ├─ KV          raw DRM keys per film (production: vendor-held keys instead)
                    ├─ Workflow    encode-film: waits for the runner, marks the film ready
                    ├─ Durable Obj PartyRoom: roster, chat, pinned message, moderation, playback clock
                    └─ fetch ──▶  Axinom (licenses)   Cloudflare Realtime SFU (WebRTC sessions)
encoder (Docker, polls /jobs) ──▶ R2 via presigned URLs
```

The film is delivered as HLS (Safari, FairPlay, cbcs) and DASH (Chrome, Edge, Firefox, Widevine). Chrome also plays cbcs since the key-system fix recorded in the build report. The protected-URL version is capped at 1080p because without DRM there is no HDCP.

## Repository layout

```
src/
  index.ts          entry: dispatch by first path segment, exports the Workflow and Durable Object
  routes/           one file per route family: uploads, films, runner, play, media, license, admin, test, app
  lib/              env and helpers, auth, jwt, s3 (aws4fetch), sfu, drm-vendor, util
  party/            room.ts (Durable Object) and routes.ts (party API and SFU signalling)
  encode/           workflow.ts (encode-film Workflow), queue.ts (R2 event consumer, dormant on the Free plan)
public/             app.html (/app), console.html (/player), watch.html (/watch); plain HTML with Shaka Player
migrations/         D1 schema, applied in order
encoder/            Dockerfile, encode.sh, package.sh, package_clear.sh, server.mjs (poll-mode runner)
scripts/            upload-client.py and headless browser tests (see scripts/README.md)
pricing-test/       scripts and audit from the cost measurement; the report is pricing-test/REPORT.md
docs/               proposal, build plan, build report, watch party report, independent test report
```

Older documents in `docs/` refer to files by their pre-restructure names: `src/party.ts` is now `src/party/room.ts`, `src/party-routes.ts` is `src/party/routes.ts`, `public/index.html` is `public/console.html`, `public/party.html` is `public/watch.html`, `scripts/party/` is `scripts/tests/`, and `test/REPORT.md` is `pricing-test/REPORT.md`.

## Routes

| Method and path | Who | Purpose |
|---|---|---|
| `POST /uploads`, `POST /uploads/{id}/complete`, `DELETE /uploads/{id}` | creator (`X-Creator-Id`) | multipart upload of a master |
| `GET /films`, `GET /films/{id}` | anyone | film status, keys, encode runs |
| `GET /jobs/next`, `PUT /jobs/{id}/output/*`, `POST /jobs/{id}/done` | runner token | encoder side |
| `POST /play/{id}` | session (or typed id in TEST_MODE) | 4-hour pass, `mode: "drm"` or `"url"` |
| `GET /media/{id}/v{n}/...` | pass for manifests and for every protected-URL object | manifests and segments |
| `POST /license/{widevine,playready,fairplay}`, `GET /license/fairplay/cert`, `POST /license/clearkey` | pass | licenses |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | | accounts; the first account registered is the admin |
| `GET /api/films`, `POST /api/rent/{id}`, `GET /api/parties`, `GET /api/admin/users`, `PUT /api/admin/users/{id}/role` | session; admin routes need the admin role | the app |
| `POST /party`, `GET /party/{id}`, `POST /party/{id}/ticket`, `POST /party/{id}/join`, `GET /party/{id}/ws?t=`, `GET /party/{id}/messages`, `POST /party/{id}/end` | session, then the party pass | rooms |
| `POST /party/{id}/rtc/session`, `POST .../rtc/publish`, `POST .../rtc/pull`, `PUT .../rtc/renegotiate`, `PUT .../rtc/layer`, `PUT .../rtc/close` | party pass | WebRTC signalling to the SFU |
| `POST /admin/rentals`, `GET /admin/licenses`, `POST /admin/requeue/{id}`, `DELETE /admin/films/{id}` | runner token | operator |
| `/test/*` | TEST_MODE only | console helpers; set `TEST_MODE` to `false` before launch |

## Running it

Requirements: Node 22 or newer, a Cloudflare account, and for DRM an Axinom DRM account.

```
npm install
npm run typecheck
npx wrangler login
```

Create the resources named in `wrangler.jsonc` (two R2 buckets, a D1 database, a KV namespace, a Realtime SFU app) and put their ids in that file. Then:

```
npm run migrate                       # apply migrations/ to D1
wrangler secret put JWT_SECRET        # and the others listed in .dev.vars.example
npm run deploy
```

For local development copy `.dev.vars.example` to `.dev.vars`, fill it in, and run `npm run dev`.

Variables in `wrangler.jsonc` worth knowing: `TEST_MODE` opens the `/test/*` routes and lets the legacy console use a typed viewer id; `LICENSE_RATE_LIMIT` is licenses per viewer per minute, `0` disables it; `KEY_SCHEME` is `cbcs` or `cenc` for new encodes.

### Encoder

```
cd encoder
docker build -t ztor-encoder .
docker run -e POLL_URL=https://<your worker> -e RUNNER_TOKEN=<token> -e POLL_S=15 -e RUNNER_NAME=my-mac ztor-encoder
```

With `POLL_URL` set the runner polls `/jobs/next`; without it the container only answers `POST /encode`, the call the Workflow will make once the encoder runs on Cloudflare Containers. In poll mode it encodes with ffmpeg at the ladder in `encode.sh`, packages with Shaka Packager (`package.sh` for DRM, `package_clear.sh` for the protected-URL version), uploads to the versioned output path and posts timings to `/jobs/{id}/done`. The same image is intended for Cloudflare Containers on the Workers Paid plan.

### Upload a master

```
python3 scripts/upload-client.py <worker url> /path/to/master.mov "<title>" <creator id>
```

### Tests

The tests run against a deployed Worker in headless Chrome. See [scripts/README.md](scripts/README.md).

## Costs, in one paragraph

Measured on this build (details in `docs/BUILD_REPORT.md` and `pricing-test/REPORT.md`): a one-hour 4K film watched 1,000 times costs about $2.6 to $8.7 on Cloudflare per month, and the DRM vendor's per-license fee is the line that sets the per-view price. A watch party of up to a few hundred viewers costs nothing beyond the film, because only the host's camera goes through the SFU. The whole build so far ran inside the Free plan.

## Status

Phase A is complete and verified: everything above works on a Free plan with an Axinom trial. Not built: the encoder on Cloudflare Containers and Queues (Workers Paid), a custom domain with cache rules, an Apple production FairPlay certificate, native iOS and Android players, payments for rentals and tickets, password reset, and recording of parties. The lists in `docs/BUILD_REPORT.md` section 6 and `docs/WATCH_PARTY_REPORT.md` section 5 have the price of each.
