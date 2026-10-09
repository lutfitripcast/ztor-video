#!/usr/bin/env python3
"""Phase 6 step 3: replay viewer sessions against the public bucket URL and log every response.

A "view" = what a player fetches for a full 1080p watch:
  master.m3u8, the 1080p media playlist, the audio media playlist,
  1080p init.mp4 + 13 segments, audio init.mp4 + 13 segments  -> 31 requests.
Modes:
  --light N   N views fetching only the first 1 KiB of each object (Range) -> counts requests, not bytes
  --full N    N views downloading every object completely             -> confirms egress
Writes a CSV of url,status,bytes,cf-cache-status,cf-ray,elapsed_ms per request and prints a summary.
"""
import argparse, csv, sys, time, concurrent.futures as cf
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("base")                         # e.g. https://pub-xxx.r2.dev/films/spl2
ap.add_argument("--light", type=int, default=0)
ap.add_argument("--full", type=int, default=0)
ap.add_argument("--rendition", default="video_1080p")
ap.add_argument("--playlist", default="stream_1.m3u8")   # 1080p media playlist name from master.m3u8
ap.add_argument("--audio-playlist", default="stream_0.m3u8")
ap.add_argument("--segments", type=int, default=13)
ap.add_argument("--concurrency", type=int, default=8)
ap.add_argument("--out", default="out/views.csv")
a = ap.parse_args()

objs = ["master.m3u8", a.playlist, a.audio_playlist,
        f"{a.rendition}/init.mp4", "audio/init.mp4"]
objs += [f"{a.rendition}/{i}.m4s" for i in range(1, a.segments + 1)]
objs += [f"audio/{i}.m4s" for i in range(1, a.segments + 1)]

def fetch(path, light):
    url = f"{a.base}/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "ztor-5b-test/1.0"})
    if light:
        req.add_header("Range", "bytes=0-1023")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            h = r.headers
            return (url, r.status, len(body), h.get("cf-cache-status", "-"), h.get("cf-ray", "-"),
                    int((time.time() - t0) * 1000))
    except urllib.error.HTTPError as e:
        return (url, e.code, 0, e.headers.get("cf-cache-status", "-"), e.headers.get("cf-ray", "-"),
                int((time.time() - t0) * 1000))
    except Exception as e:  # network error
        return (url, 0, 0, type(e).__name__, "-", int((time.time() - t0) * 1000))

rows = []
def run_views(n, light):
    label = "light" if light else "full"
    t0 = time.time()
    with cf.ThreadPoolExecutor(a.concurrency) as ex:
        futs = [ex.submit(fetch, p, light) for _ in range(n) for p in objs]
        for i, f in enumerate(cf.as_completed(futs), 1):
            rows.append((label,) + f.result())
            if i % 500 == 0:
                print(f"  {label}: {i}/{len(futs)} requests, {time.time()-t0:.0f}s", file=sys.stderr)
    print(f"{label} views done: {n} views, {n*len(objs)} requests in {time.time()-t0:.0f}s", file=sys.stderr)

if a.light: run_views(a.light, True)
if a.full: run_views(a.full, False)

with open(a.out, "w", newline="") as f:
    w = csv.writer(f); w.writerow(["mode", "url", "status", "bytes", "cf_cache_status", "cf_ray", "ms"]); w.writerows(rows)

# summary
from collections import Counter
print(f"\nrequests: {len(rows)}   objects per view: {len(objs)}")
print("status codes:", dict(Counter(r[2] for r in rows)))
print("cf-cache-status:", dict(Counter(r[4] for r in rows)))
print(f"bytes downloaded: {sum(r[3] for r in rows)/1e9:.3f} GB")
ms = sorted(r[6] for r in rows)
if ms: print(f"latency ms: p50={ms[len(ms)//2]} p95={ms[int(len(ms)*0.95)]} max={ms[-1]}")
print(f"csv: {a.out}")
