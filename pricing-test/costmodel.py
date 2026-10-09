#!/usr/bin/env python3
"""Phase 5: recompute the Option 5B cost table from measured numbers.

Reads out/source_probe.json, out/timing/*.txt and out/packaged/timing/inventory.csv,
applies Cloudflare unit prices verified on 2026-09-20, and prints:
  1. the cost of THIS file on the R2 + DRM path at several view counts,
  2. the proposal's 1-hour 4K film, re-projected from the measured ratios.
DRM is a fixed assumption (2 licenses per play, $0.005-$0.02 each), not measured.
"""
import csv, json, re, sys
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "out")

# ---- Unit prices, Cloudflare public pages, checked 2026-09-20 ---------------------------
P = dict(
    r2_storage_gb_month=0.015,      # developers.cloudflare.com/r2/pricing  (Standard)
    r2_ia_storage_gb_month=0.01,    # Infrequent Access
    r2_class_a_per_m=4.50,          # PutObject, UploadPart, CompleteMultipartUpload ...
    r2_class_b_per_m=0.36,          # GetObject, HeadObject ...
    r2_egress_gb=0.0,               # "Free"
    ct_vcpu_s=0.000020,             # developers.cloudflare.com/containers/pricing
    ct_gib_s=0.0000025,
    ct_disk_gb_s=0.00000007,
    workers_paid_month=5.0,
)
STD4 = dict(vcpu=4, gib=12, disk_gb=20)  # standard-4 instance (containers/platform-details/limits)
CONTAINER_COST_PER_WALL_S = (STD4["vcpu"] * P["ct_vcpu_s"] + STD4["gib"] * P["ct_gib_s"]
                             + STD4["disk_gb"] * P["ct_disk_gb_s"])

# ---- DRM assumption (unchanged from proposal, NOT verified) -----------------------------
LIC_PER_PLAY = 2
LIC_PRICE = (0.005, 0.02)

# ---- Load measurements ------------------------------------------------------------------
probe = json.loads((OUT / "source_probe.json").read_text())
DUR = float(probe["format"]["duration"])
MASTER_BYTES = int(probe["format"]["size"])

def timing(name):
    t = (OUT / "timing" / f"{name}.txt").read_text()
    return {k: float(v) for k, v in re.findall(r"(\w+)=([\d.]+)", t)}

T = {n: timing(n) for n in ["video_2160p", "video_1080p", "video_720p", "video_480p",
                            "video_360p", "audio_aac128", "combined_ladder_1080_down"]}

inv = {}
with (OUT / "packaged" / "timing" / "inventory.csv").open() as f:
    for row in csv.DictReader(f):
        inv[row["rendition"]] = (int(row["files"]), int(row["bytes"]))

GB = 1e9
def mbps(b): return b * 8 / DUR / 1e6
def money(x): return f"${x:,.6f}" if x < 0.001 else (f"${x:,.4f}" if x < 0.1 else f"${x:,.2f}")

print("=" * 78)
print(f"SOURCE  duration={DUR:.1f}s  size={MASTER_BYTES/GB:.3f} GB  bitrate={mbps(MASTER_BYTES):.1f} Mbps  "
      f"{probe['streams'][0]['codec_long_name']} {probe['streams'][0]['width']}x{probe['streams'][0]['height']}")
print("=" * 78)

# ---- Measured encode ---------------------------------------------------------------------
print("\nENCODE TIMING on 4 pinned cores (per rung, separate ffmpeg runs)")
print(f"{'rung':<28}{'wall s':>8}{'cpu s':>8}{'x realtime':>12}{'peak RSS MB':>13}")
for n, t in T.items():
    cpu = t["user_s"] + t["sys_s"]
    print(f"{n:<28}{t['wall_s']:>8.1f}{cpu:>8.1f}{t['wall_s']/DUR:>12.2f}{t['maxrss_kb']/1024:>13.0f}")
wall_1080_ladder = T["combined_ladder_1080_down"]["wall_s"]           # true ladder for a 1080p source
wall_full_ladder = T["video_2160p"]["wall_s"] + wall_1080_ladder      # 5-rung ladder incl. 4K rung
print(f"\ncontainer cost per wall-second on standard-4 (4 vCPU + 12 GiB + 20 GB): ${CONTAINER_COST_PER_WALL_S:.7f}")

# ---- Measured renditions ----------------------------------------------------------------
print("\nPACKAGED OUTPUT (CMAF, 6 s segments, cbcs)")
print(f"{'rendition':<14}{'files':>6}{'MB':>9}{'Mbps':>7}")
for n, (files, b) in inv.items():
    if n in ("total",): continue
    print(f"{n:<14}{files:>6}{b/1e6:>9.2f}{mbps(b) if n!='manifests' else 0:>7.2f}")
files_total, bytes_total = inv["total"]
print(f"{'total':<14}{files_total:>6}{bytes_total/1e6:>9.2f}")

# ---- 1. THIS FILE, R2 + DRM path ---------------------------------------------------------
# Honest ladder for a 1080p master = 4 video rungs + audio (the 4K rung was a timing pass only).
files_4k, bytes_4k = inv["video_2160p"]
ren_files = files_total - files_4k - 1            # minus the 2160p media playlist
ren_bytes = bytes_total - bytes_4k
stored_gb = (MASTER_BYTES + ren_bytes) / GB
segs = inv["video_1080p"][0] - 1                  # media segments per rendition
reqs_per_view = 1 + 2 + 2 + 2 * segs              # master + 2 media playlists + 2 inits + video&audio segments
bytes_per_view = inv["video_1080p"][1] + inv["audio"][1]   # full watch at top rung

print("\n" + "=" * 78)
print("1. THIS FILE on Option 5B (R2 + CDN + DRM). 4-rung ladder, full watch at 1080p.")
print("=" * 78)
print(f"stored: master {MASTER_BYTES/GB:.3f} GB + renditions+manifests {ren_bytes/1e6:.1f} MB = {stored_gb:.3f} GB "
      f"(master is {MASTER_BYTES/(MASTER_BYTES+ren_bytes)*100:.0f}% of it)")
print(f"objects written: {ren_files}   requests per full view: {reqs_per_view}   bytes per view: {bytes_per_view/1e6:.1f} MB")
enc_cost = wall_1080_ladder * CONTAINER_COST_PER_WALL_S
for views in (1_000, 10_000, 100_000):
    storage = stored_gb * P["r2_storage_gb_month"]
    writes = ren_files / 1e6 * P["r2_class_a_per_m"]
    reads_worst = views * reqs_per_view / 1e6 * P["r2_class_b_per_m"]       # every request a cache miss
    reads_95 = reads_worst * 0.05                                            # 95 % cache hit
    egress_gb = views * bytes_per_view / GB
    cf_total = enc_cost + storage + writes + reads_worst
    drm = tuple(views * LIC_PER_PLAY * p for p in LIC_PRICE)
    print(f"\n  {views:,} views / month")
    print(f"    encode (once, {wall_1080_ladder:.0f} s wall)      {money(enc_cost)}")
    print(f"    storage / month                    {money(storage)}")
    print(f"    R2 writes (once)                   {money(writes)}")
    print(f"    R2 reads, all cache misses         {money(reads_worst)}   (95% hit rate: {money(reads_95)})")
    print(f"    delivery {egress_gb:,.1f} GB                 $0")
    print(f"    Cloudflare subtotal                {money(cf_total)}   = {money(cf_total/views)} per view")
    print(f"    DRM {LIC_PER_PLAY} licenses/play (assumed)     {money(drm[0])} - {money(drm[1])}")
    print(f"    TOTAL                              {money(cf_total+drm[0])} - {money(cf_total+drm[1])}"
          f"   = ${ (cf_total+drm[0])/views:.4f} - ${ (cf_total+drm[1])/views:.4f} per view")
print(f"\n  Note: R2 free tier (10 GB, 1M Class A, 10M Class B per month) would make every line but DRM $0 for a single film.")

# ---- 2. PROPOSAL'S 1-HOUR 4K FILM, re-projected -----------------------------------------
H = 3600.0
print("\n" + "=" * 78)
print("2. PROPOSAL CASE: 1-hour 4K film, 1,000 full views, re-projected from measurements")
print("=" * 78)
ratio_full = wall_full_ladder / DUR
enc_wall_floor = H * ratio_full
enc_floor = enc_wall_floor * CONTAINER_COST_PER_WALL_S
print(f"encode: measured {ratio_full:.2f}x realtime for the 5-rung ladder (4K rung from an UPSCALED 1080p source)")
print(f"  -> 1 h film = {enc_wall_floor/3600:.1f} h wall on standard-4 = {money(enc_floor)}  [measured floor]")
print(f"  -> true 4K source decodes ~4x more pixels and carries real detail: allow 1.5x-2x = "
      f"{enc_wall_floor*1.5/3600:.1f}-{enc_wall_floor*2/3600:.1f} h = {money(enc_floor*1.5)}-{money(enc_floor*2)}  [extrapolated]")
print(f"  proposal said: ~3-5 h, ~$1-2")

ren_mbps = sum(mbps(b) for n, (f, b) in inv.items() if n not in ("total", "manifests"))
ren_gb_h = ren_mbps * H / 8 / 1e3
print(f"\nstorage: measured ladder totals {ren_mbps:.1f} Mbps -> {ren_gb_h:.1f} GB per hour of renditions")
prores_1080_gb_h = mbps(MASTER_BYTES) * H / 8 / 1e3
prores_4k_gb_h = prores_1080_gb_h * 4
for label, master_gb in [("proposal's implied master (~30 GB total)", 30 - ren_gb_h),
                         ("ProRes 422 HQ 1080p master (this file's rate)", prores_1080_gb_h),
                         ("ProRes 422 HQ 4K master (4x pixels)", prores_4k_gb_h)]:
    tot = master_gb + ren_gb_h
    print(f"  {label:<48} {tot:>6.0f} GB  {money(tot*P['r2_storage_gb_month'])}/month"
          f"  (master on Infrequent Access: {money(master_gb*P['r2_ia_storage_gb_month']+ren_gb_h*P['r2_storage_gb_month'])})")

segs_h = int(H // 6)
objects_h = 6 * (segs_h + 1) + 8
writes_h = objects_h / 1e6 * P["r2_class_a_per_m"]
parts_master = prores_4k_gb_h * 1e3 / 100   # 100 MB multipart parts
print(f"\nR2 writes: {objects_h:,} objects -> {money(writes_h)}  (+ ~{parts_master:,.0f} multipart parts for a 4K ProRes master: "
      f"{money(parts_master/1e6*P['r2_class_a_per_m'])}). proposal said ~4,000 writes, ~$0.02")

reqs_h = 1 + 2 + 2 + 2 * segs_h
for views in (1_000,):
    worst = views * reqs_h
    print(f"R2 reads: {reqs_h:,} requests per full view (video AND audio segments) x {views:,} views = {worst/1e6:.2f}M worst case "
          f"-> {money(worst/1e6*P['r2_class_b_per_m'])}; at 95% cache hit {money(worst*0.05/1e6*P['r2_class_b_per_m'])}. "
          f"proposal said <= 600k reads, <= $0.22")

v4k = mbps(inv["video_2160p"][1]) + mbps(inv["audio"][1])
v1080 = mbps(inv["video_1080p"][1]) + mbps(inv["audio"][1])
print(f"\ndelivery: full view = {v4k*H/8/1e3:.1f} GB at 2160p or {v1080*H/8/1e3:.1f} GB at 1080p "
      f"(proposal: 3.6 GB at ~8 Mbps average). R2 egress is $0 either way.")

print(f"\nDRM: {LIC_PER_PLAY} x 1,000 x ${LIC_PRICE[0]}-{LIC_PRICE[1]} = $10-$40. NOT verified; proposal's assumption kept as is.")
print(f"Shared: Workers Paid ${P['workers_paid_month']:.0f}/month (verified). Containers monthly allowance: 375 vCPU-min, 25 GiB-h, 200 GB-h.")

cf_low = enc_floor + 30 * P["r2_storage_gb_month"] + writes_h + 0.05 * reqs_h * 1000 / 1e6 * P["r2_class_b_per_m"]
cf_high = enc_floor * 2 + (prores_4k_gb_h + ren_gb_h) * P["r2_storage_gb_month"] + writes_h + parts_master/1e6*P['r2_class_a_per_m'] + reqs_h * 1000 / 1e6 * P["r2_class_b_per_m"]
print(f"\nCLOUDFLARE SUBTOTAL for the 1-hour 4K film, 1,000 views: {money(cf_low)} (best case) to {money(cf_high)} (ProRes 4K master, slow encode, no cache)")
print(f"  = ${cf_low/1000:.4f} - ${cf_high/1000:.4f} per view.  Proposal: ~$1.7-2.7, i.e. $0.002-0.003 per view.")
print(f"TOTAL incl. DRM: {money(cf_low+10)} - {money(cf_high+40)}  vs proposal $12-43.")
