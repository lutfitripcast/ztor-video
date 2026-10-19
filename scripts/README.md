# Scripts

All tests drive the deployed Worker from this machine. They need Node 22 or newer and, for the browser tests, Playwright with Google Chrome installed (`npm i --no-save playwright`; the real Chrome is used so Widevine and WebRTC behave as they do for users). Point them at another deployment with `BASE_URL`, and at another film with `FILM`.

| Script | Needs | What it checks |
|---|---|---|
| `tests/party-test.mjs` | Node only | the room protocol: create without rental (402), join, chat rate limit, viewer clock refused, kick and rejoin (403) |
| `tests/checks-test.mjs` | Chrome | the console's seven security checks on one film |
| `tests/browser-test.mjs` | Chrome | host and viewer in a party: camera tile, film sync, pause follows |
| `tests/app-test.mjs` | Chrome, wrangler | accounts and roles end to end: register, admin promotes a host, party with ticket, chat with names, sync |
| `tests/mic-test.mjs` | Chrome, wrangler | mic-only mode and the host's camera stop and restart |
| `tests/simulcast-test.mjs` | Chrome | the three simulcast layers and the layer switch route |
| `tests/restart-test.mjs`, `tests/screen-reload-test.mjs` | Chrome | host reload and republish |
| `tests/settings-test.mjs` | Chrome, wrangler | the Settings menu: per-person subtitles (+ size), audio and quality in a party, phone sheet and landscape panel, Watch page; `LOCAL_APP=1` serves this checkout's page, `FILM` picks the film, `NO_SUBS=1` for a film without subtitles |
| `tests/scrub-test.mjs` | Chrome, wrangler | drags, stalls, reload, link drops, end of party; `BASE_URL` picks the Worker |
| `tests/format-test.mjs` | real Chrome with Widevine (launched on a debugging port), wrangler | every ready film, DRM and protected-URL versions, over HLS; `HOST_RULES` pins addresses on networks that hijack workers.dev DNS; `WRANGLER_PROFILE` / `WRANGLER_CONFIG` pick the account |

Scripts that create throwaway accounts clean them up through `wrangler d1 execute` at the end, so they need a logged-in wrangler.

`upload-client.py` uploads a master through the presigned multipart routes: `python3 scripts/upload-client.py <worker url> <file> "<title>" <creator id>`.
