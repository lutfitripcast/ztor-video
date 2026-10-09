#!/usr/bin/env python3
"""Proposal step 3 test client: upload a master straight to R2 through presigned part URLs.
Usage: upload-client.py <worker_base_url> <file> [title] [creatorId]
The file never passes through the Worker; only the small JSON calls do.
"""
import json, os, sys, time, urllib.request, concurrent.futures as cf

base, path = sys.argv[1].rstrip("/"), sys.argv[2]
title = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(path)
creator = sys.argv[4] if len(sys.argv) > 4 else "creator-1"
size = os.path.getsize(path)

def call(method, url, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"content-type": "application/json", "user-agent": "ztor-upload-client/1.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or b"{}")

t0 = time.time()
init = call("POST", f"{base}/uploads", {"title": title, "sizeBytes": size, "filename": os.path.basename(path)}, {"x-creator-id": creator})
print(f"film {init['filmId']}  parts={init['parts']}  partSize={init['partSize']//1048576} MiB")

def put_part(n):
    off = (n - 1) * init["partSize"]
    with open(path, "rb") as f:
        f.seek(off); chunk = f.read(init["partSize"])
    for attempt in range(1, 5):
        try:
            req = urllib.request.Request(init["urls"][n - 1], data=chunk, method="PUT", headers={"user-agent": "ztor-upload-client/1.0"})
            with urllib.request.urlopen(req, timeout=600) as r:
                return {"partNumber": n, "etag": r.headers["ETag"]}
        except Exception as e:
            if attempt == 4: raise
            time.sleep(2 * attempt)

with cf.ThreadPoolExecutor(4) as ex:
    parts = list(ex.map(put_part, range(1, init["parts"] + 1)))
    for p in parts: print(f"  part {p['partNumber']} {p['etag']}")
done = call("POST", f"{base}/uploads/{init['filmId']}/complete", {"parts": parts})
dt = time.time() - t0
print(f"complete: {json.dumps(done)}")
print(f"{size/1e9:.3f} GB in {dt:.0f}s ({size*8/dt/1e6:.1f} Mbps); status now: {call('GET', f'{base}/films/{init['filmId']}')['status']}")
