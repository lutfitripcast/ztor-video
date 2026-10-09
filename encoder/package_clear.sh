#!/usr/bin/env bash
# Protected-URL version: the same renditions packaged as CMAF HLS + DASH, 6 s segments, NO encryption.
# The only protection is the signed, expiring URL the Worker requires on every manifest and segment.
# Usage: package_clear.sh <renditions_dir> <outdir>
set -euo pipefail
REN="$1"; OUT="$2"
rm -rf "$OUT"; mkdir -p "$OUT"
ARGS=()
for f in "$REN"/video_*p.mp4; do
  n=$(basename "$f" .mp4)
  ARGS+=("in=$f,stream=video,init_segment=$OUT/$n/init.mp4,segment_template=$OUT/$n/\$Number\$.m4s")
done
if [ -f "$REN/audio_128k.mp4" ]; then
  ARGS+=("in=$REN/audio_128k.mp4,stream=audio,init_segment=$OUT/audio/init.mp4,segment_template=$OUT/audio/\$Number\$.m4s")
fi
packager "${ARGS[@]}" \
  --segment_duration 6 --fragment_duration 6 --generate_static_live_mpd \
  --mpd_output "$OUT/manifest.mpd" --hls_master_playlist_output "$OUT/master.m3u8" \
  --quiet
find "$OUT" -type f | wc -l | sed 's/^/files=/'
