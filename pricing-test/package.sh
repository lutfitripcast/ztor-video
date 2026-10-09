#!/usr/bin/env bash
# Phase 3: Shaka Packager, CMAF, 6 s segments, HLS + DASH, cbcs raw-key encryption (stand-in for vendor keys).
# Usage: package.sh <renditions_dir> <outdir>
set -euo pipefail
REN="$1"; OUT="$2"
rm -rf "$OUT"; mkdir -p "$OUT/timing"
# Local stand-in keys. In production these come from the DRM vendor's CPIX API (proposal step 6).
VKID=$(od -An -N16 -tx1 /dev/urandom | tr -d " \n"); VKEY=$(od -An -N16 -tx1 /dev/urandom | tr -d " \n")
AKID=$(od -An -N16 -tx1 /dev/urandom | tr -d " \n"); AKEY=$(od -An -N16 -tx1 /dev/urandom | tr -d " \n")
ARGS=()
for f in "$REN"/video_*p.mp4; do
  n=$(basename "$f" .mp4)
  ARGS+=("in=$f,stream=video,init_segment=$OUT/$n/init.mp4,segment_template=$OUT/$n/\$Number\$.m4s,drm_label=VIDEO")
done
ARGS+=("in=$REN/audio_128k.mp4,stream=audio,init_segment=$OUT/audio/init.mp4,segment_template=$OUT/audio/\$Number\$.m4s,drm_label=AUDIO")
/usr/bin/time -f "wall_s=%e user_s=%U sys_s=%S maxrss_kb=%M" -o "$OUT/timing/package.txt" \
packager "${ARGS[@]}" \
  --segment_duration 6 --fragment_duration 6 --generate_static_live_mpd --clear_lead 0 \
  --enable_raw_key_encryption --protection_scheme cbcs \
  --keys "label=VIDEO:key_id=$VKID:key=$VKEY,label=AUDIO:key_id=$AKID:key=$AKEY" \
  --protection_systems Widevine,FairPlay,PlayReady \
  --hls_key_uri "skd://ztor-test/$VKID" \
  --mpd_output "$OUT/manifest.mpd" --hls_master_playlist_output "$OUT/master.m3u8"
echo "package: $(cat "$OUT/timing/package.txt")"
# Inventory: files and bytes per rendition = R2 objects (Class A writes) and bytes per full view.
{
  echo "rendition,files,bytes"
  for d in "$OUT"/video_*p "$OUT"/audio; do
    echo "$(basename "$d"),$(find "$d" -type f | wc -l | tr -d ' '),$(find "$d" -type f -exec stat -c %s {} + | awk '{s+=$1} END{print s+0}')"
  done
  echo "manifests,$(find "$OUT" -maxdepth 2 -type f \( -name '*.mpd' -o -name '*.m3u8' \) | wc -l | tr -d ' '),$(find "$OUT" -maxdepth 2 -type f \( -name '*.mpd' -o -name '*.m3u8' \) -exec stat -c %s {} + | awk '{s+=$1} END{print s+0}')"
  echo "total,$(find "$OUT" -type f -not -path '*/timing/*' | wc -l | tr -d ' '),$(find "$OUT" -type f -not -path '*/timing/*' -exec stat -c %s {} + | awk '{s+=$1} END{print s+0}')"
} | tee "$OUT/timing/inventory.csv"
