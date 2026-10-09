#!/usr/bin/env python3
"""Black-box audit of the ztor-video Worker against proposal section 4. Read-only except: one aborted upload record,
one probe viewer's rentals (revoked at the end) and the license rows those probes create."""
import json, random, re, string, struct, sys, time, urllib.request, urllib.error, base64, xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
B = "https://ztor-video.mluthfi840.workers.dev"
UA = "ztor-audit/1.0"
FILMS = {"SPL2": ("439662d9-e97b-44f5-9ae1-7bd346553e4b", 5), "VULG4K": ("ae60bf2f-5bd1-44cc-838b-d60e4594b98d", 9), "X9": ("becd8657-a8c0-4502-838d-527cb533d166", 1)}
D1_KEYS = {  # from D1 film_keys, read 2026-09-21
 "439662d9-e97b-44f5-9ae1-7bd346553e4b": {"AUDIO": "487dd9cef63eb9e89d8fdeefbee25117", "VIDEO": "f48ea1b553a95225913efc4a03afecdf", "VIDEO_UHD": "a2f4cace6d62f2b1d3d4c2e6d1c72e11"},
 "ae60bf2f-5bd1-44cc-838b-d60e4594b98d": {"AUDIO": "e0ef5085994c2071bd9c524e510d33f7", "VIDEO": "1d39b33d9f9cec196b0cdf699fae936f", "VIDEO_UHD": "d30be75e1e2d49d6fcd2a55a1ce49fa5"},
 "becd8657-a8c0-4502-838d-527cb533d166": {"AUDIO": "e3a226ab5be290a0715c928d23ac5d5e", "VIDEO": "f9f3c7611e9acf8dc277a37ba76e0979", "VIDEO_UHD": "596395fba95b3f3cb1ca7a9f80b85f05"}}
PROBE = "audit-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
R = {"probe": PROBE, "checks": []}
def note(k, ok, detail): R["checks"].append({"check": k, "ok": ok, "detail": detail}); print(("PASS " if ok else "FAIL ") + k + " :: " + str(detail)[:300], flush=True)
def req(method, url, body=None, headers=None, raw=False, timeout=60):
    h = {"User-Agent": UA}; h.update(headers or {})
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)): data = bytes(body)
        else: data = json.dumps(body).encode(); h.setdefault("content-type", "application/json")
    rq = urllib.request.Request(url, method=method, data=data, headers=h)
    try: r = urllib.request.urlopen(rq, timeout=timeout); status, hdr, b = r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e: status, hdr, b = e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
    if raw: return status, hdr, b
    try: j = json.loads(b)
    except Exception: j = b.decode("utf-8", "replace")
    return status, hdr, j
def b64u_dec(s): return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
def jwt_claims(t): return json.loads(b64u_dec(t.split(".")[1]))
def boxes(buf):
    """top-level and recursive box types present in an ISO BMFF buffer (names only)."""
    found = set()
    def walk(b, off, end):
        while off + 8 <= end:
            size, typ = struct.unpack(">I4s", b[off:off + 8]); typ = typ.decode("latin1"); hs = 8
            if size == 1: size = struct.unpack(">Q", b[off + 8:off + 16])[0]; hs = 16
            if size == 0: size = end - off
            if size < hs: return
            found.add(typ)
            if typ in ("moov", "trak", "mdia", "minf", "stbl", "moof", "traf", "stsd", "sinf", "schi", "encv", "enca", "mvex"):
                inner = off + hs + (8 if typ in ("stsd",) else 0) + (78 if typ == "encv" else 0) + (28 if typ == "enca" else 0)
                walk(b, inner, off + size)
            off += size
    walk(buf, 0, len(buf)); return found
def find_box(buf, typ):
    i = buf.find(typ.encode("latin1")); return None if i < 4 else i - 4
# ---------------------------------------------------------------- step 2: buckets
st, h, b = req("GET", "https://89a040897539ed3a26aad722df127442.r2.cloudflarestorage.com/ztor-masters/?list-type=2", raw=True)
note("step2.masters_s3_unauth", 400 <= st < 500, f"S3 endpoint list without credentials -> {st}")
for bn, pub in (("ztor-masters", "pub-74c116aa49a545e58268000f8c5a9dab.r2.dev"), ("ztor-streams", "pub-ac5cf0e43de947b5a6369951cbdafe94.r2.dev")):
    try: stp, _, _ = req("GET", f"https://{pub}/", raw=True, timeout=20)
    except Exception as e: stp = f"conn error {type(e).__name__}"
    note(f"step2.{bn}_r2dev_disabled", stp in (404, 403) or isinstance(stp, str), f"{pub} -> {stp} (managed domain enabled:false per API)")
st, h, b = req("GET", B + "/media/x/masters/anything", raw=True)
note("step2.masters_not_via_worker", st == 404, f"Worker has no masters route -> {st}")
import os
SKIP = os.environ.get("SKIP_HEAVY") == "1"
# ---------------------------------------------------------------- step 3: upload dry run
if SKIP: print("skipping upload dry run")
else:
  pass
st, h, j = (401, {}, None) if SKIP else req("POST", B + "/uploads", {"title": "audit dry run", "sizeBytes": 250 * 1024 * 1024, "filename": "x.mov"})
if not SKIP: note("step3.upload_needs_creator", st == 401, f"no X-Creator-Id -> {st} {j}")
st, h, j = (0, {}, None) if SKIP else req("POST", B + "/uploads", {"title": "audit dry run", "sizeBytes": 250 * 1024 * 1024, "filename": "x.mov"}, {"X-Creator-Id": "audit"})
if SKIP: pass
elif st == 200:
    u0 = j["urls"][0]
    ok = (len(j["urls"]) == 3 and j["parts"] == 3 and "X-Amz-Expires=3600" in u0 and "ztor-masters" in u0 and "r2.cloudflarestorage.com" in u0 and "partNumber=1" in u0 and "uploadId=" in u0 and j["key"].startswith(f"masters/{j['filmId']}/source."))
    note("step3.presigned_parts", ok, f"parts={j['parts']} urls={len(j['urls'])} partSize={j['partSize']} key={j['key']} expires={j['expiresInS']} host_ok={'r2.cloudflarestorage.com' in u0} sigv4={'X-Amz-Signature' in u0}")
    st2, _, f = req("GET", B + f"/films/{j['filmId']}")
    note("step3.d1_row_uploading", st2 == 200 and f["status"] == "uploading" and f["creator_id"] == "audit", f"status={f.get('status')} creator={f.get('creator_id')}")
    st3, _, a = req("DELETE", B + f"/uploads/{j['filmId']}")
    note("step3.abort", st3 == 200, a); R["dryrun_film"] = j["filmId"]
else: note("step3.presigned_parts", False, f"{st} {j}")
# ---------------------------------------------------------------- per film: steps 5,6,7
def media(fid, v, rel, token=None, q=False, method="GET"):
    url = f"{B}/media/{fid}/v{v}/{rel}" + (f"?t={token}" if (token and q) else "")
    return req(method, url, headers=({"Authorization": "Bearer " + token} if token and not q else {}), raw=True)
R["films"] = {}
for name, (fid, v) in FILMS.items():
    F = R["films"][name] = {"id": fid, "version": v}
    print(f"\n===== {name} {fid[:8]} v{v}")
    st, _, j = req("POST", f"{B}/play/{fid}", {"userId": PROBE, "deviceId": "audit"})
    note(f"{name}.step7.402_without_rental", st == 402 and j.get("error") == "Rent this film to watch it.", f"{st} {j}")
    st, _, j = req("POST", f"{B}/play/{fid}", {"deviceId": "audit"})
    note(f"{name}.step7.401_without_login", st == 401, f"{st}")
    st, _, rent = req("POST", f"{B}/test/rent", {"userId": PROBE, "filmId": fid, "hours": 48})
    F["rental_expires"] = rent.get("expires_at")
    t0 = time.time()
    st, _, pN = req("POST", f"{B}/play/{fid}", {"userId": PROBE, "deviceId": "audit", "caps": {"hdcp": False}})
    st2, _, pY = req("POST", f"{B}/play/{fid}", {"userId": PROBE, "deviceId": "audit", "caps": {"hdcp": True}})
    if st != 200 or st2 != 200: note(f"{name}.step7.play_with_rental", False, f"{st} {pN} / {st2} {pY}"); continue
    cN, cY = jwt_claims(pN["token"]), jwt_claims(pY["token"])
    note(f"{name}.step7.pass_4h", cN["exp"] - cN["iat"] == 14400 and pN["expiresInS"] == 14400 and abs(cN["iat"] - t0) < 120, f"exp-iat={cN['exp']-cN['iat']}s claims={ {k: cN[k] for k in ('sub','filmId','deviceId','uhd')} }")
    note(f"{name}.step7.links_and_policy", pN["dash"].startswith(f"{B}/media/{fid}/v{v}/manifest.mpd?t=") and pN["hls"].startswith(f"{B}/media/{fid}/v{v}/master.m3u8?t=") and pN["policy"]["maxHeight"] == 1080 and pY["policy"]["maxHeight"] == 2160 and pN["policy"]["rentalWindowH"] == 48 and pN["policy"]["offline"] is False, f"policy no-hdcp={pN['policy']} vendor={pN.get('drm')}")
    F["policy"] = {"nohdcp": pN["policy"], "hdcp": pY["policy"]}
    # manifests gated
    st, h, _ = media(fid, v, "manifest.mpd"); note(f"{name}.step7.mpd_401_no_pass", st == 401, st)
    st, h, _ = media(fid, v, "manifest.mpd", "forged.pass.value"); note(f"{name}.step7.mpd_401_forged", st == 401, st)
    hdr, pl, sig = pN["token"].split("."); tam = hdr + "." + base64.urlsafe_b64encode(json.dumps({**cN, "sub": "someone-else", "uhd": True}).encode()).decode().rstrip("=") + "." + sig
    st, h, _ = media(fid, v, "manifest.mpd", tam); note(f"{name}.step7.mpd_401_tampered_claims", st == 401, st)
    other = [x for x in FILMS.values() if x[0] != fid][0]
    st, h, _ = media(other[0], other[1], "manifest.mpd", pN["token"]); note(f"{name}.step7.mpd_401_other_film_pass", st == 401, f"pass for {fid[:8]} on {other[0][:8]} -> {st}")
    st, h, mpd = media(fid, v, "manifest.mpd", pN["token"]); note(f"{name}.step7.mpd_200_header_pass", st == 200, f"{st} cache-control={h.get('cache-control')} ct={h.get('content-type')}")
    F["mpd_cache_control"] = h.get("cache-control")
    st, h, _ = media(fid, v, "manifest.mpd", pN["token"], q=True); note(f"{name}.step7.mpd_200_query_pass", st == 200, st)
    # HLS master filtered by policy
    st, h, m3N = media(fid, v, "master.m3u8", pN["token"], q=True); st2, _, m3Y = media(fid, v, "master.m3u8", pY["token"], q=True)
    def variants(m):
        txt = m.decode(); out = []; lines = txt.split("\n")
        for i, l in enumerate(lines):
            if l.startswith("#EXT-X-STREAM-INF"):
                out.append({"res": re.search(r"RESOLUTION=(\d+x\d+)", l).group(1), "bw": int(re.search(r"BANDWIDTH=(\d+)", l).group(1)), "uri": lines[i + 1].strip()})
        return out, txt
    vN, txtN = variants(m3N); vY, txtY = variants(m3Y)
    hN = max(int(x["res"].split("x")[1]) for x in vN); hY = max(int(x["res"].split("x")[1]) for x in vY)
    has_uhd_rung = hY >= 2160
    note(f"{name}.step8.hls_master_policy_filter", st == 200 and hN <= 1080 and (hY == 2160 if has_uhd_rung else True) and all("?t=" in x["uri"] for x in vN), f"variants no-hdcp={[x['res'] for x in vN]} hdcp={[x['res'] for x in vY]} pass_in_uris={all('?t=' in x['uri'] for x in vN)} cc={h.get('cache-control')}")
    F["hls_variants_hdcp"] = vY
    # media playlist gated too, and key lines
    mp_uri = vY[0]["uri"].split("?")[0]
    st, _, _ = media(fid, v, mp_uri); note(f"{name}.step7.media_playlist_401_no_pass", st == 401, st)
    keylines = {}
    for x in vY:
        u = x["uri"].split("?")[0]
        st, _, plb = media(fid, v, u, pY["token"], q=True)
        ks = [l for l in plb.decode().split("\n") if l.startswith("#EXT-X-KEY")]
        keylines[u] = ks
    audio_uri = re.search(r'#EXT-X-MEDIA:TYPE=AUDIO[^\n]*URI="([^"?]+)', txtY)
    if audio_uri:
        st, _, plb = media(fid, v, audio_uri.group(1), pY["token"], q=True)
        keylines[audio_uri.group(1)] = [l for l in plb.decode().split("\n") if l.startswith("#EXT-X-KEY")]
    F["hls_keylines"] = keylines
    fmts = sorted({re.search(r'KEYFORMAT="([^"]+)"', l).group(1) for ks in keylines.values() for l in ks if "KEYFORMAT=" in l})
    skd = sorted({re.search(r'URI="(skd://[^"]+)"', l).group(1) for ks in keylines.values() for l in ks if "skd://" in l})
    kids = D1_KEYS[fid]; guid = lambda k: f"{k[:8]}-{k[8:12]}-{k[12:16]}-{k[16:20]}-{k[20:]}"
    skd_kids = {s.split("//")[1].split(":")[0] for s in skd}
    expected_kids = {guid(kids["VIDEO"]), guid(kids["AUDIO"])} | ({guid(kids["VIDEO_UHD"])} if has_uhd_rung else set())
    note(f"{name}.step5.hls_key_signalling", "com.apple.streamingkeydelivery" in fmts and "identity" not in fmts and skd_kids == expected_kids and all(":" in s.split("//")[1] for s in skd), f"keyformats={fmts} skd_kids_match_D1={skd_kids == expected_kids} iv_present={all(':' in s.split('//')[1] for s in skd)} n_skd={len(skd)}")
    # DASH manifest analysis
    ns = {"m": "urn:mpeg:dash:schema:mpd:2011", "cenc": "urn:mpeg:cenc:2013"}
    root = ET.fromstring(mpd)
    dur = root.get("mediaPresentationDuration"); typ = root.get("type")
    reps = []; prot = {}
    for aset in root.iter("{urn:mpeg:dash:schema:mpd:2011}AdaptationSet"):
        ct = aset.get("contentType") or aset.get("mimeType", "")
        cps = aset.findall("m:ContentProtection", ns)
        kid = None; schemes = []
        for cp in cps:
            k = cp.get("{urn:mpeg:cenc:2013}default_KID")
            if k: kid = k.replace("-", "").lower(); schemes.append(cp.get("value"))
            else: schemes.append(cp.get("schemeIdUri"))
        for rep in aset.findall("m:Representation", ns):
            stpl = rep.find("m:SegmentTemplate", ns) or aset.find("m:SegmentTemplate", ns)
            segdur = None
            if stpl is not None and stpl.get("duration"): segdur = int(stpl.get("duration")) / int(stpl.get("timescale", "1"))
            elif stpl is not None:
                tl = stpl.find("m:SegmentTimeline", ns)
                if tl is not None:
                    ds = [int(s.get("d")) for s in tl.findall("m:S", ns)]; segdur = max(ds) / int(stpl.get("timescale", "1"))
            reps.append({"type": ct, "id": rep.get("id"), "height": rep.get("height") or aset.get("height"), "bandwidth": int(rep.get("bandwidth")), "codecs": rep.get("codecs"), "kid": kid, "schemes": schemes, "segdur": segdur, "media": (stpl.get("media") if stpl is not None else None), "init": (stpl.get("initialization") if stpl is not None else None)})
    F["mpd"] = {"type": typ, "duration": dur, "reps": reps}
    heights = sorted({int(r["height"]) for r in reps if r["height"]}, reverse=True)
    wanted_bw = {2160: 16000, 1080: 6000, 720: 3000, 480: 1500, 360: 800}
    bw = {int(r["height"]): r["bandwidth"] for r in reps if r["height"]}
    all_kids = {r["kid"] for r in reps}
    uuids = {s for r in reps for s in r["schemes"] if s and s.startswith("urn:uuid")}
    scheme_vals = {s for r in reps for s in r["schemes"] if s in ("cenc", "cbcs")}
    note(f"{name}.step5.dash_ladder", set(heights) <= {2160, 1080, 720, 480, 360} and all(abs(r["segdur"] - 6) < 0.05 for r in reps) and typ == "static" and all(bw[hh] / 1000 >= wanted_bw[hh] for hh in heights), f"peak(@bandwidth)>=target={ {hh: bw[hh]/1000 >= wanted_bw[hh] for hh in heights} } type={typ} dur={dur} heights={heights} kbps={ {hh: round(bw[hh]/1000) for hh in heights} } segdur={ {r['segdur'] for r in reps} }")
    exp_kids = {kids["VIDEO"], kids["AUDIO"]} | ({kids["VIDEO_UHD"]} if 2160 in heights else set())
    note(f"{name}.step6.dash_kids_match_d1", all_kids == exp_kids, f"mpd_kids={sorted(all_kids)} d1={sorted(exp_kids)}")
    note(f"{name}.step5.dash_drm_signalling", {"urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed", "urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"} <= uuids and len(scheme_vals) == 1, f"scheme={scheme_vals} systems={sorted(u.split(':')[-1][:8] for u in uuids)}")
    F["scheme"] = list(scheme_vals)
    # segments: public, immutable, encrypted from segment 1 (clear_lead 0); init boxes
    seg_info = {}
    for rname in ["video_360p", "video_1080p"] + (["video_2160p"] if 2160 in heights else []) + ["audio"]:
        st, h, init = media(fid, v, f"{rname}/init.mp4")
        ib = boxes(init); schm = init[find_box(init, "schm") + 12:find_box(init, "schm") + 16].decode("latin1") if find_box(init, "schm") else None
        tenc_off = find_box(init, "tenc"); tenc_kid = init[tenc_off + 8 + 4 + 4:tenc_off + 8 + 4 + 4 + 16].hex() if tenc_off else None
        segs = {}
        for n in (1, 2, 3):
            st2, h2, sb = media(fid, v, f"{rname}/{n}.m4s")
            segs[n] = {"status": st2, "bytes": len(sb), "senc": "senc" in boxes(sb), "cache": h2.get("cache-control")}
            if n <= 2: open(f"seg_{name}_{rname}_{n}.m4s", "wb").write(sb)
        open(f"init_{name}_{rname}.mp4", "wb").write(init)
        seg_info[rname] = {"init_status": st, "init_cache": h.get("cache-control"), "schm": schm, "tenc_kid": tenc_kid, "encv_or_enca": ("encv" in ib or "enca" in ib), "segs": segs}
    F["segments"] = seg_info
    note(f"{name}.step7.segments_public_immutable", all(s["segs"][n]["status"] == 200 and s["segs"][n]["cache"] == "public, max-age=31536000, immutable" for s in seg_info.values() for n in (1, 2, 3)), {k: v_["segs"][1]["cache"] for k, v_ in seg_info.items()})
    note(f"{name}.step5.clear_lead_0_all_segments_encrypted", all(s["segs"][n]["senc"] for s in seg_info.values() for n in (1, 2, 3)) and all(s["encv_or_enca"] for s in seg_info.values()), {k: [v_["segs"][n]["senc"] for n in (1, 2, 3)] for k, v_ in seg_info.items()})
    note(f"{name}.step5.init_scheme_and_kid", all(s["schm"] in scheme_vals for s in seg_info.values()) and all(s["tenc_kid"] in exp_kids for s in seg_info.values()), {k: (v_["schm"], v_["tenc_kid"][:8] if v_["tenc_kid"] else None) for k, v_ in seg_info.items()})
    st, h, _ = media(fid, v, "video_360p/1.m4s", method="HEAD"); note(f"{name}.step7.segment_head_ranges", st == 200 and h.get("accept-ranges") == "bytes", f"HEAD {st} accept-ranges={h.get('accept-ranges')} len={h.get('content-length')}")
    # ------------------------------------------------------------ step 8: license door
    st, _, j = req("POST", f"{B}/license/widevine", b"\x08\x04", headers={"content-type": "application/octet-stream"}); note(f"{name}.step8.license_401_no_pass", st == 401, f"{st} {j}")
    st, _, j = req("POST", f"{B}/license/clearkey", {"kids": []}, headers={"Authorization": "Bearer " + pY["token"]}); note(f"{name}.step8.clearkey_closed_410", st == 410, f"{st} {j}")
    st, h, cert = req("GET", f"{B}/license/fairplay/cert", raw=True); note(f"{name}.step8.fairplay_cert", st == 200 and len(cert) > 500, f"{st} {len(cert)} bytes cc={h.get('cache-control')}")
    # entitlement contents (TEST_MODE debug route) with and without HDCP
    st, _, eN = req("GET", f"{B}/test/drm-token/{fid}?user={PROBE}&hdcp=0"); st2, _, eY = req("GET", f"{B}/test/drm-token/{fid}?user={PROBE}&hdcp=1")
    mN, mY = eN["message"], eY["message"]
    pol = {p["name"]: p for p in mY["content_key_usage_policies"]}
    note(f"{name}.step8.entitlement_policy", mY["license"]["expiration_datetime"] == F["rental_expires"] and mY["license"]["allow_persistence"] is False and pol["UHD"]["widevine"].get("hdcp") == "2.2" and pol["UHD"]["fairplay"].get("hdcp") == "TYPE1" and pol["UHD"]["widevine"]["device_security_level"] == "HW_SECURE_ALL", f"expiry==rental_expiry={mY['license']['expiration_datetime'] == F['rental_expires']} persistence={mY['license']['allow_persistence']} UHD={pol['UHD']}")
    note(f"{name}.step8.uhd_key_only_with_hdcp", len(eN["keyIds"]) == 2 and len(eY["keyIds"]) == 3 and {k.replace('-', '') for k in eN["keyIds"]} == {kids["VIDEO"], kids["AUDIO"]}, f"keys no-hdcp={len(eN['keyIds'])} hdcp={len(eY['keyIds'])}")
    F["entitlement_no_hdcp"] = mN; F["axinom_token_valid"] = eY["token"]
    # rate limit + log, on one film only (12 dummy requests)
    if name == "SPL2" and not SKIP:
        st, _, s0 = req("GET", f"{B}/test/status/{fid}?user={PROBE}"); n0 = s0["licensesThisUser"]
        codes = []; msgs = []
        for i in range(12):
            st, h, body = req("POST", f"{B}/license/widevine", b"\x08\x04", headers={"Authorization": "Bearer " + pY["token"], "content-type": "application/octet-stream"}, raw=True)
            codes.append(st); msgs.append(h.get("x-axdrm-message") or body[:80].decode("utf-8", "replace"))
        st, _, s1 = req("GET", f"{B}/test/status/{fid}?user={PROBE}"); n1 = s1["licensesThisUser"]
        fwd = sum(1 for c in codes if c != 429)
        note("SPL2.step8.rate_limit_10_per_min", codes[10] == 429 and codes[11] == 429 and fwd == 10, f"codes={codes}")
        note("SPL2.step8.one_row_per_forwarded_license", n1 - n0 == fwd, f"rows before={n0} after={n1} forwarded={fwd} upstream_msgs={sorted(set(msgs))}")
        R["rate_limit_codes"] = codes; R["upstream_msgs"] = sorted(set(msgs))
# ------------------------------------------------------------ Axinom accepts valid, refuses tampered (direct, dummy body)
tok = R["films"]["SPL2"]["axinom_token_valid"]
WV = "https://af7427b7.drm-widevine-licensing.axprod.net/AcquireLicense"
st1, h1, b1 = req("POST", WV, b"\x08\x04", headers={"X-AxDRM-Message": tok, "content-type": "application/octet-stream"}, raw=True)
bad = tok[:-2] + ("A" if tok[-2] != "A" else "B") + tok[-1]
st2, h2, b2 = req("POST", WV, b"\x08\x04", headers={"X-AxDRM-Message": bad, "content-type": "application/octet-stream"}, raw=True)
m1 = h1.get("x-axdrm-errormessage") or ("<binary %d bytes, HTTP %d>" % (len(b1), st1)); m2 = h2.get("x-axdrm-errormessage") or ("<binary %d bytes, HTTP %d>" % (len(b2), st2))
note("step8.axinom_valid_vs_tampered", st1 == 200 and st2 == 400 and ("signature" in m2.lower()), f"valid -> {st1} '{m1}' | tampered -> {st2} '{m2}'")
# ------------------------------------------------------------ exposure findings (TEST_MODE)
st, _, j = req("GET", f"{B}/admin/licenses"); note("admin.requires_runner_token", st == 401, st)
st, _, j = req("GET", f"{B}/jobs/next"); note("jobs.requires_runner_token", st == 401, st)
note("EXPOSURE.test_rent_is_anonymous", False, "POST /test/rent granted a 48 h rental to any userId with no credential (TEST_MODE=true on the public Worker)")
note("EXPOSURE.test_drm_token_is_anonymous", False, "GET /test/drm-token/{film} returns a signed Axinom entitlement usable directly against the vendor with a real device (TEST_MODE=true)")
# ------------------------------------------------------------ cleanup
for name, (fid, v) in FILMS.items(): req("DELETE", f"{B}/test/rent", {"userId": PROBE, "filmId": fid})
st, _, s = req("GET", f"{B}/test/status/{FILMS['SPL2'][0]}?user={PROBE}"); note("cleanup.probe_rentals_revoked", s["rental"]["active"] is False, s["rental"])
json.dump(R, open("audit_results.json", "w"), indent=1, default=str)
print(f"\nTOTAL {sum(1 for c in R['checks'] if c['ok'])}/{len(R['checks'])} passed; results in audit_results.json")
