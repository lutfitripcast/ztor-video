#!/usr/bin/env bash
# Proposal step 5, part 1: H.264 ladder, 2-second GOP aligned across renditions, AAC 128k stereo per audio language (2026-10-16).
# Usage: encode.sh <source (path or presigned URL)> <outdir> [maxHeight]
# One ffmpeg run: the master is decoded once. Rungs above the source height are skipped (no upscaling).
set -euo pipefail
SRC="$1"; OUT="$2"; MAXH="${3:-2160}"
mkdir -p "$OUT"
FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$SRC" | head -1)
GOP=$(python3 -c "from fractions import Fraction; print(round(float(Fraction('$FPS'))*2))" 2>/dev/null || echo 48)
# Audio languages (2026-10-16): every audio stream of the master becomes its own stereo AAC file, audio_<lang>.mp4, named by
# the stream's language tag. One untagged stream is accepted as "und" (shown as "Original"); with several streams every
# one must be tagged, or the languages cannot be told apart and the job stops here with a clear message.
AUDIO_LANGS=()
while IFS=, read -r IDX LANG; do
  [ -z "$IDX" ] && continue
  LANG=$(echo "${LANG:-und}" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9-'); [ -z "$LANG" ] && LANG=und
  AUDIO_LANGS+=("$LANG")
done < <(ffprobe -v error -select_streams a -show_entries stream=index:stream_tags=language -of csv=p=0 "$SRC")
if [ "${#AUDIO_LANGS[@]}" -gt 1 ]; then
  for L in "${AUDIO_LANGS[@]}"; do [ "$L" = "und" ] && { echo "audio: ${#AUDIO_LANGS[@]} audio tracks but one has no language tag; tag every track (eng, yue, cmn, ...) and deliver again" >&2; exit 1; }; done
  DUP=$(printf '%s\n' "${AUDIO_LANGS[@]}" | sort | uniq -d | head -1); [ -n "$DUP" ] && { echo "audio: two tracks are tagged '$DUP'; every track needs a different language" >&2; exit 1; }
fi

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
AI=0; for L in "${AUDIO_LANGS[@]}"; do ARGS+=(-map 0:a:$AI -vn -c:a aac -b:a 128k -ac 2 -metadata:s:a:0 language=$L -f mp4 "$OUT/audio_${L}.mp4"); AI=$((AI+1)); done
echo "audio tracks: ${AUDIO_LANGS[*]:-none}"
[ "${#AUDIO_LANGS[@]}" -gt 0 ] && echo "${AUDIO_LANGS[0]}" > "$OUT/audio_default"   # the master's first track is the default language

ffmpeg "${ARGS[@]}"
echo "rungs=${LABELS[*]} gop=$GOP audio=${HAS_AUDIO:-none}"
ls -l "$OUT"
