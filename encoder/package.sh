#!/usr/bin/env bash
# Proposal step 5, part 2: Shaka Packager -> CMAF, HLS + DASH, 6 s segments, encrypted with the keys we are given.
# Usage: package.sh <renditions_dir> <outdir> <keys "label=VIDEO:key_id=..:key=..,label=AUDIO:..."> [scheme cbcs|cenc]
set -euo pipefail
REN="$1"; OUT="$2"; KEYS="$3"; SCHEME="${4:-cbcs}"; IV="${5:-}"
IVOPT=(); [ -n "$IV" ] && IVOPT=(--iv "$IV")   # constant IV (cbcs); FairPlay licenses need the same IV inline
rm -rf "$OUT"; mkdir -p "$OUT"
ARGS=()
for f in "$REN"/video_*p.mp4; do
  n=$(basename "$f" .mp4)
  LABEL=VIDEO; case "$n" in video_2160p) echo "$KEYS" | grep -q 'label=VIDEO_UHD' && LABEL=VIDEO_UHD;; esac
  ARGS+=("in=$f,stream=video,init_segment=$OUT/$n/init.mp4,segment_template=$OUT/$n/\$Number\$.m4s,drm_label=$LABEL")
done
if [ -f "$REN/audio_128k.mp4" ]; then
  ARGS+=("in=$REN/audio_128k.mp4,stream=audio,init_segment=$OUT/audio/init.mp4,segment_template=$OUT/audio/\$Number\$.m4s,drm_label=AUDIO")
fi
VKID=$(echo "$KEYS" | sed -n 's/.*label=VIDEO:key_id=\([0-9a-fA-F]*\).*/\1/p')
UKID=$(echo "$KEYS" | sed -n 's/.*label=VIDEO_UHD:key_id=\([0-9a-fA-F]*\).*/\1/p')
AKID=$(echo "$KEYS" | sed -n 's/.*label=AUDIO:key_id=\([0-9a-fA-F]*\).*/\1/p')
guid() { local h=$(echo "$1" | tr 'A-F' 'a-f'); echo "${h:0:8}-${h:8:4}-${h:12:4}-${h:16:4}-${h:20:12}"; }
# Axinom FairPlay key URI: skd://<key id as GUID>:<IV hex>. One URI per stream, rewritten per playlist below.
skd() { echo "skd://$(guid "$1")${IV:+:$IV}"; }
packager "${ARGS[@]}" \
  --segment_duration 6 --fragment_duration 6 --generate_static_live_mpd --clear_lead 0 \
  --enable_raw_key_encryption --protection_scheme "$SCHEME" "${IVOPT[@]}" \
  --keys "$KEYS" \
  --protection_systems Widevine,FairPlay,PlayReady \
  --hls_key_uri "$(skd "$VKID")" \
  --mpd_output "$OUT/manifest.mpd" --hls_master_playlist_output "$OUT/master.m3u8" \
  --quiet
# The packager writes one key URI for every playlist; give each rendition its own key id (video / UHD / audio).
for pl in "$OUT"/stream_*.m3u8; do
  [ -f "$pl" ] || continue
  if grep -q 'video_2160p/' "$pl" && [ -n "$UKID" ]; then K="$UKID"; elif grep -q '^audio/' "$pl" && [ -n "$AKID" ]; then K="$AKID"; else K="$VKID"; fi
  sed -i "s|URI=\"skd://[^\"]*\"|URI=\"$(skd "$K")\"|" "$pl"
  sed -i '/KEYFORMAT="identity"/d' "$pl"   # no ClearKey key line in HLS: Safari must only see the FairPlay entry
done
find "$OUT" -type f | wc -l | sed 's/^/files=/'
