#!/usr/bin/env bash
# Proposal step 5, part 1: H.264 ladder, 2-second GOP aligned across renditions, AAC 128k.
# Usage: encode.sh <source (path or presigned URL)> <outdir> [maxHeight]
# One ffmpeg run: the master is decoded once. Rungs above the source height are skipped (no upscaling).
set -euo pipefail
SRC="$1"; OUT="$2"; MAXH="${3:-2160}"
mkdir -p "$OUT"
FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$SRC" | head -1)
GOP=$(python3 -c "from fractions import Fraction; print(round(float(Fraction('$FPS'))*2))" 2>/dev/null || echo 48)
HAS_AUDIO=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$SRC" | head -1)

# height bitrate_k maxrate_k bufsize_k
LADDER="2160 16000 17600 32000
1080 6000 6600 12000
720 3000 3300 6000
480 1500 1650 3000
360 800 880 1600"

X264="-c:v libx264 -preset medium -profile:v high -g $GOP -keyint_min $GOP -sc_threshold 0 -pix_fmt yuv420p -force_key_frames expr:gte(t,n_forced*2)"
FILTERS=""; MAPS=(); N=0; LABELS=()
while read -r H BR MAXR BUF; do
  [ "$H" -gt "$MAXH" ] && continue
  LABELS+=("$H"); N=$((N+1))
done <<< "$LADDER"
[ "$N" -eq 0 ] && { echo "no rung fits height $MAXH" >&2; exit 1; }

SPLIT="[0:v]split=$N"; i=0
for H in "${LABELS[@]}"; do SPLIT="$SPLIT[s$i]"; i=$((i+1)); done
FILTERS="$SPLIT"; i=0
for H in "${LABELS[@]}"; do FILTERS="$FILTERS;[s$i]scale=-2:${H}:flags=lanczos[v$H]"; i=$((i+1)); done

# HTTP(S) sources: reconnect on dropped connections instead of silently treating a reset as end-of-file.
NETOPTS=(); case "$SRC" in http://*|https://*) NETOPTS=(-reconnect 1 -reconnect_streamed 1 -reconnect_on_network_error 1 -reconnect_on_http_error 5xx -reconnect_delay_max 30 -rw_timeout 30000000);; esac
ARGS=(-nostdin -v error -y "${NETOPTS[@]}" -i "$SRC" -filter_complex "$FILTERS")
while read -r H BR MAXR BUF; do
  [ "$H" -gt "$MAXH" ] && continue
  ARGS+=(-map "[v$H]" $X264 -b:v ${BR}k -maxrate ${MAXR}k -bufsize ${BUF}k -an -f mp4 -movflags +faststart "$OUT/video_${H}p.mp4")
done <<< "$LADDER"
if [ -n "$HAS_AUDIO" ]; then ARGS+=(-map 0:a:0 -vn -c:a aac -b:a 128k -ac 2 -f mp4 "$OUT/audio_128k.mp4"); fi

ffmpeg "${ARGS[@]}"
echo "rungs=${LABELS[*]} gop=$GOP audio=${HAS_AUDIO:-none}"
ls -l "$OUT"
