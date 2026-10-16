# Uploading and transcoding films on the Ztor platform

Date: 2026-10-14, revised the same day: the uploading team also runs the encoder. For the team doing the upload and the encode. Platform: `https://ztor-video.eric-tam.workers.dev`, running on Eric.tam@travelconnect.co's Cloudflare account (Account ID `4c18ad534efba2ad881e179b90e8dfb4`).

The platform does its own transcoding. A film is uploaded once as a master file into a private Cloudflare R2 bucket; the Ztor encoder makes the renditions; the packager produces **one HLS asset that carries all three DRM systems**, and a second, unencrypted copy with signed links for watch parties. Playback is served by the platform from R2. No other Cloudflare product is involved.

## 1. The file

- MP4 (or MOV), under 30 GB
- H.264 video, progressive, constant frame rate, 8-bit SDR
- AAC stereo audio as the first audio track
- Bitrate: 20 to 40 Mbps for a 1080p master, 50 to 80 Mbps for 2160p
- Subtitles: separate WebVTT files per language (section 6a), or burned in
- ASCII file name, no spaces, for example `SPL2_master_2160p.mp4`

Full detail, checksums and the handover sheet in FILM_DELIVERY_SPEC.txt.

## 2. What you need

| Item | Value or where to get it |
|---|---|
| Platform URL | `https://ztor-video.eric-tam.workers.dev` |
| Creator id | any short name, e.g. `cn-team`; it is recorded on the film |
| The upload script | `scripts/upload-client.py` from the ztor-video repository; needs Python 3 only |
| The encoder | **run by you** on any machine with Docker (section 4); the Ztor side sends you the runner token |
| Runner token | a secret the encoder uses to talk to the platform; sent to you separately, never in chat |
| DRM | Axinom, already configured on the account; nothing to do |

## 3. Upload

```
python3 scripts/upload-client.py https://ztor-video.eric-tam.workers.dev SPL2_master_2160p.mp4 "SPL2 trailer" cn-team
```

The script asks the platform for presigned part links (100 MB each), sends the parts straight into the private `ztor-masters` bucket, and completes the upload, which starts the encode workflow. It prints the film id, for example `8fe9ebad-5821-4d49-b284-677645342c0e`. Behind the script, the calls are:

```
POST https://ztor-video.eric-tam.workers.dev/uploads                      {title, sizeBytes, filename}   header X-Creator-Id
PUT  <each presigned part link>                                           the file bytes
POST https://ztor-video.eric-tam.workers.dev/uploads/<FILM_ID>/complete   {parts: [{partNumber, etag}]}
```

Every upload is marked for both versions, DRM and watch party; nothing to set.

## 4. Encode: run the encoder on your machine

The film does not encode by itself. Someone runs the encoder, and it can be any machine with Docker; it pulls the master from the platform's storage, so it does not need the original file. Run it on a machine that can stay on for hours.

What the machine needs:

- Docker Desktop (Windows, Mac) or Docker Engine (Linux), running
- free disk of about **three times the film's master size** (renditions plus two packaged copies); 25 GB for a 6 GB master
- time: roughly 4 to 5 times the film's length for 1080p, more for 4K; a 95-minute film is 6 to 8 hours
- the `encoder` folder from the ztor-video repository (we send it as a zip if you have no repository access)
- the runner token, sent to you separately

Build the image once, in the folder that contains `encoder`:

```
docker build -t ztor-encoder encoder
```

Start the encoder in poll mode. It asks the platform every 10 s for the next queued film, encodes it, uploads the result and reports:

```
docker run -d --name ztor-runner -e POLL_URL=https://ztor-video.eric-tam.workers.dev -e RUNNER_TOKEN=<token we sent you> -e RUNNER_NAME=cn-team-pc -e POLL_S=10 ztor-encoder
```

On Windows PowerShell use the same command on one line. To put the working files on a bigger drive, add `-e WORK_DIR=/work/tmp -v D:\ztor-work:/work/tmp` (Windows) or `-v /Volumes/Big/ztor-work:/work/tmp` (Mac).

Watch it:

```
docker logs -f ztor-runner
```

You will see `job <film id>`, then `source 1920x1080 ...`, the encode timing, `packaged ...`, `uploaded N files`, and `done -> 200`. Upload failures retry on their own; a line with `FAILED` means the job stopped and we should look at the log together.

Check the film from any browser while it runs:

```
https://ztor-video.eric-tam.workers.dev/films/<FILM_ID>
```

`status` goes `queued` → `encoding` → `packaged` → `ready`. When it is `ready`, stop the encoder:

```
docker rm -f ztor-runner
```

Leave it running if more films are queued; it takes them one after another.

## 5. What the encoder produces

- Renditions: 2160p (if the master is 4K), 1080p, 720p, 480p, 360p in H.264, plus AAC stereo
- fMP4 (CMAF) segments of 6 seconds, encrypted with CENC **cbcs**, the one mode FairPlay accepts and that Widevine and PlayReady also support, so a single set of segments serves all three
- Three keys per film (SD/HD video, 2160p video, audio), carried as `EXT-X-KEY` lines in every variant playlist and told apart by `KEYFORMAT`:
  - `com.apple.streamingkeydelivery` → Safari, iPhone, iPad (FairPlay)
  - `urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed` → Chrome, Android (Widevine)
  - `com.microsoft.playready` → Windows Edge (PlayReady; Edge can also use Widevine)
- Each player picks the key for the DRM it has. HLS only; no DASH is produced.
- The watch-party copy: the same renditions packaged clear, every manifest and segment link signed, capped at 1080p

## 6. Play

A viewer who has rented the film asks for a 4-hour pass:

```
POST https://ztor-video.eric-tam.workers.dev/play/<FILM_ID>     {deviceId, mode: "drm"}     (signed-in session)
```

The pass contains the HLS link and the licence endpoints:

```
hls:       https://ztor-video.eric-tam.workers.dev/media/<FILM_ID>/v1/master.m3u8?t=<pass>
widevine:  https://ztor-video.eric-tam.workers.dev/license/widevine
playready: https://ztor-video.eric-tam.workers.dev/license/playready
fairplay:  https://ztor-video.eric-tam.workers.dev/license/fairplay   (certificate at /license/fairplay/cert)
```

Chrome, Edge and Android play the HLS with Widevine or PlayReady; Safari and iPhones with FairPlay. `mode: "url"` returns the watch-party copy instead: the same HLS, no licence, every link signed.

## 6a. Subtitles

Subtitles are separate WebVTT files, one per language, added after the film is uploaded (before or after encoding, it does not matter). On the Watch page each viewer picks their own language in the player's "subtitles" selector, remembered on that device. In a watch party the **host** picks the language and every viewer follows it; viewers have no selector. The cues follow the playback position, including seeks and party sync.

File: UTF-8 WebVTT (`.vtt`, starting with `WEBVTT`); an SRT file is accepted and converted. Name it with the language tag: `en-us.vtt`, `zh-hk.vtt`, `zh-cn.vtt`, `ms.vtt`, `id.vtt`.

Upload one file per language with the runner token:

```
curl -X PUT "https://ztor-video.eric-tam.workers.dev/admin/films/<FILM_ID>/subtitles/zh-hk" -H "Authorization: Bearer <runner token>" -H "Content-Type: text/vtt" --data-binary @zh-hk.vtt
```

The answer reports the number of cues. Uploading the same language again replaces it; `DELETE` on the same URL removes it. The pass and the party join then list the tracks under `subtitles`, and the player shows them.

## 6b. Audio languages

A film can carry several audio languages. Deliver them inside the one master file: one stereo track per language, each tagged with its language (`eng`, `yue`, `cmn`, `jpn`, ...), the default language first. The encoder makes one AAC track per language and the player lists them in an "audio" selector, shown only when a film has more than one. On the Watch page each viewer picks their own language, remembered on that device. In a watch party the **host** picks and every viewer follows; viewers have no selector. Switching takes about half a second and never reloads the player.

A master with two or more audio tracks where one has no language tag is refused by the encoder, with the reason in the job log. Dubs cannot be added later as separate files; re-deliver the master with the extra track and encode again. Films encoded before 2026-10-16 keep their single track.

## 7. Remove a film

Operator call, with the runner token: `DELETE https://ztor-video.eric-tam.workers.dev/admin/films/<FILM_ID>` removes the master, every rendition and the keys.

## 8. Checklist

- [ ] File to the spec, with its size and SHA-256 in the handover sheet
- [ ] Upload script, platform URL, encoder folder and runner token at hand
- [ ] Upload (section 3); note the film id
- [ ] Start the encoder (section 4) and watch it until the film is `ready`
- [ ] Tell the Ztor side the film id; playback checked in Chrome and Safari
