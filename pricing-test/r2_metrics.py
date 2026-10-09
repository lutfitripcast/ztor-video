#!/usr/bin/env python3
"""Read-only: R2 operation counts and storage for the test bucket from Cloudflare GraphQL analytics.
Usage: r2_metrics.py [from_iso] [to_iso]
"""
import json, re, sys, urllib.request
from pathlib import Path

ACC = "89a040897539ed3a26aad722df127442"
BUCKET = "ztor-5b-test"
FROM = sys.argv[1] if len(sys.argv) > 1 else "2026-09-20T00:00:00Z"
TO = sys.argv[2] if len(sys.argv) > 2 else "2026-09-22T00:00:00Z"
cfg = Path.home() / "Library/Preferences/.wrangler/config/default.toml"
TOKEN = re.search(r'^oauth_token\s*=\s*"([^"]+)"', cfg.read_text(), re.M).group(1)

CLASS_A = {"ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload",
           "CreateMultipartUpload", "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts",
           "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration", "LifecycleStorageTierTransition"}

query = """
{ viewer { accounts(filter:{accountTag:"%s"}) {
    ops: r2OperationsAdaptiveGroups(limit:100, filter:{datetime_geq:"%s", datetime_leq:"%s", bucketName:"%s"}) {
      dimensions { actionType actionStatus } sum { requests responseObjectSize } }
    storage: r2StorageAdaptiveGroups(limit:1, filter:{datetime_geq:"%s", datetime_leq:"%s", bucketName:"%s"}, orderBy:[datetime_DESC]) {
      dimensions { datetime } max { payloadSize objectCount uploadCount metadataSize } }
} } }""" % (ACC, FROM, TO, BUCKET, FROM, TO, BUCKET)

req = urllib.request.Request("https://api.cloudflare.com/client/v4/graphql", method="POST",
                             data=json.dumps({"query": query}).encode(),
                             headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
d = json.load(urllib.request.urlopen(req, timeout=60))
if d.get("errors"):
    print(d["errors"]); sys.exit(1)
a = d["data"]["viewer"]["accounts"][0]

print(f"window {FROM} .. {TO}")
print(f"{'action':<26}{'status':<10}{'requests':>10}{'resp bytes':>16}")
tot, tot_bytes = {}, 0
for g in sorted(a["ops"], key=lambda g: -g["sum"]["requests"]):
    dm, s = g["dimensions"], g["sum"]
    print(f"{dm['actionType']:<26}{dm['actionStatus']:<10}{s['requests']:>10}{s['responseObjectSize']:>16,}")
    tot[dm["actionType"]] = tot.get(dm["actionType"], 0) + s["requests"]
    tot_bytes += s["responseObjectSize"]
ca = sum(v for k, v in tot.items() if k in CLASS_A)
cb = sum(v for k, v in tot.items() if k not in CLASS_A)
print(f"Class A total: {ca:,}   Class B total: {cb:,}   response bytes: {tot_bytes/1e9:.3f} GB")
print(f"cost at list price: Class A ${ca/1e6*4.50:.5f}  Class B ${cb/1e6*0.36:.5f}  egress $0")
if a["storage"]:
    m = a["storage"][0]["max"]
    print(f"storage latest ({a['storage'][0]['dimensions']['datetime']}): {m['payloadSize']/1e9:.3f} GB payload, "
          f"{m['objectCount']} objects, {m['uploadCount']} in-progress multipart uploads")
