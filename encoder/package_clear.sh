#!/usr/bin/env bash
# Protected-URL version: the same renditions packaged as CMAF HLS (HLS only since 2026-10-13), 6 s segments, NO encryption.
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
# Audio (2026-10-16): one playlist per language in a single HLS audio group. audio_128k.mp4 is the pre-2026-10-16 single
# unnamed track and keeps its old audio/ folder; tagged tracks go to audio_<lang>/. The first file in name order is the default.
for f in "$REN"/audio_*.mp4; do
  [ -f "$f" ] || continue
  n=$(basename "$f" .mp4); lang=${n#audio_}; [ "$lang" = "128k" ] && lang=und
  dir=audio_$lang; [ "$lang" = "und" ] && dir=audio
  ARGS+=("in=$f,stream=audio,language=$lang,hls_name=$lang,hls_group_id=audio,init_segment=$OUT/$dir/init.mp4,segment_template=$OUT/$dir/\$Number\$.m4s")
done
DEFLANG=(); [ -s "$REN/audio_default" ] && DEFLANG=(--default_language "$(cat "$REN/audio_default")")
packager "${ARGS[@]}" "${DEFLANG[@]}" \
  --segment_duration 6 --fragment_duration 6 --generate_static_live_mpd \
  --hls_master_playlist_output "$OUT/master.m3u8" \
  --quiet
find "$OUT" -type f | wc -l | sed 's/^/files=/'
