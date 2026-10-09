#!/usr/bin/env python3
"""Publish this folder to a new GitHub repository through the API, for a machine without git.

Usage:  GH_TOKEN=<personal access token with repo scope> python3 scripts/publish-to-github.py [repo name] [--public]
Run it from the repository root (the folder that holds package.json). The token is read from the environment only.

What it does: checks the token, creates a private repository (auto-initialised so the branch exists), uploads every
file except node_modules, .wrangler, .dev.vars, .DS_Store, screenshots and scripts/tests/out as blobs, builds one
tree and one commit on top of the initial commit, and moves the default branch to it. Run it once; a second run stops
when the repository already exists.
"""
import os, sys, json, base64, urllib.request, urllib.error

T = os.environ.get("GH_TOKEN")
if not T: sys.exit("set GH_TOKEN")
name = next((a for a in sys.argv[1:] if not a.startswith("--")), "ztor-video")
private = "--public" not in sys.argv
API = "https://api.github.com"
DESC = ("Film streaming on Cloudflare Workers: R2 storage, multi-DRM (Widevine, PlayReady, FairPlay) or signed protected "
        "URLs, rentals, and synchronized watch parties with the host on WebRTC. No origin server.")
EXCL_DIRS = {"node_modules", ".wrangler", "out"}
EXCL_FILES = {".DS_Store", ".dev.vars"}


def gh(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"authorization": "Bearer " + T, "accept": "application/vnd.github+json",
                                          "content-type": "application/json", "user-agent": "publish-to-github"})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")


s, me = gh("GET", "/user")
if s != 200: sys.exit(f"token check failed: {s} {me.get('message')}")
print("account:", me["login"])
s, repo = gh("POST", "/user/repos", {"name": name, "description": DESC, "private": private, "auto_init": True, "has_wiki": False, "has_projects": False})
if s == 422: sys.exit("repository exists already; nothing was changed")
if s != 201: sys.exit(f"create failed: {s} {repo.get('message')} {repo.get('errors')}")
full, branch = repo["full_name"], repo["default_branch"]
print("created", repo["html_url"])

files = []
for root, dirs, names in os.walk("."):
    dirs[:] = [d for d in dirs if d not in EXCL_DIRS]
    for n in names:
        if n in EXCL_FILES or n.endswith(".png"): continue
        files.append(os.path.relpath(os.path.join(root, n), "."))
files.sort()
print("uploading", len(files), "files")
tree = []
for f in files:
    raw = open(f, "rb").read()
    try: body = {"content": raw.decode("utf-8"), "encoding": "utf-8"}
    except UnicodeDecodeError: body = {"content": base64.b64encode(raw).decode(), "encoding": "base64"}
    s, b = gh("POST", f"/repos/{full}/git/blobs", body)
    if s != 201: sys.exit(f"blob failed for {f}: {s} {b.get('message')}")
    mode = "100755" if os.access(f, os.X_OK) and f.endswith((".sh", ".py")) else "100644"
    tree.append({"path": f, "mode": mode, "type": "blob", "sha": b["sha"]})
s, t = gh("POST", f"/repos/{full}/git/trees", {"tree": tree})
if s != 201: sys.exit(f"tree failed: {s} {t.get('message')}")
s, ref = gh("GET", f"/repos/{full}/git/ref/heads/{branch}")
msg = ("ztor-video: film streaming on Cloudflare Workers\n\n"
       "One Worker with R2 storage, D1, KV, a Workflow for encoding, a Durable Object per watch party and the Realtime SFU\n"
       "for the host's camera. Multi-DRM through Axinom or signed protected URLs, rentals, accounts with roles, and\n"
       "synchronized watch parties. Plain HTML pages with Shaka Player. Docs and the pricing test scripts included.\n\n"
       "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>")
s, c = gh("POST", f"/repos/{full}/git/commits", {"message": msg, "tree": t["sha"], "parents": [ref["object"]["sha"]]})
if s != 201: sys.exit(f"commit failed: {s} {c.get('message')}")
s, r = gh("PATCH", f"/repos/{full}/git/refs/heads/{branch}", {"sha": c["sha"], "force": False})
if s != 200: sys.exit(f"branch update failed: {s} {r.get('message')}")
print("done:", repo["html_url"], "commit", c["sha"][:10])
