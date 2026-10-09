#!/usr/bin/env bash
# Phase 2: encode the proposal's H.264 ladder, one ffmpeg run per rung, timing each.
# Usage: encode.sh <source> <outdir> [with4k=1]
set -euo pipefail
SRC="$1"; OUT="$2"; WITH4K="${3:-1}"
mkdir -p "$OUT/renditions" "$OUT/timing"
ffprobe -v error -show_format -show_streams -of json "$SRC" > "$OUT/source_probe.json"
FPS_RAW=$(jq -r '.streams[] | select(.codec_type=="video") | .r_frame_rate' "$OUT/source_probe.json" | head -1)
FPS=$(echo "scale=6; $FPS_RAW" | bc)
GOP=$(printf "%.0f" "$(echo "$FPS*2" | bc)")   # 2-second GOP as the proposal specifies
echo "source fps=$FPS gop=$GOP frames" | tee "$OUT/timing/params.txt"
nproc | sed 's/^/cpus visible: /' | tee -a "$OUT/timing/params.txt"

# name height bitrate(k)
LADDER="1080 1080 6000
720 720 3000
480 480 1500
360 360 800"
[ "$WITH4K" = "1" ] && LADDER="2160 2160 16000
$LADDER"

TIMEFMT="wall_s=%e user_s=%U sys_s=%S maxrss_kb=%M"
run_timed() { # label, cmd...
  local label="$1"; shift
  /usr/bin/time -f "$TIMEFMT" -o "$OUT/timing/$label.txt" "$@"
  echo "$label: $(cat "$OUT/timing/$label.txt")"
}

echo "$LADDER" | while read -r NAME H BR; do
  MAXR=$((BR*11/10)); BUF=$((BR*2))
  run_timed "video_${NAME}p" ffmpeg -nostdin -v error -y -i "$SRC" -an \
    -vf "scale=-2:${H}:flags=lanczos" -c:v libx264 -preset medium -profile:v high \
    -b:v ${BR}k -maxrate ${MAXR}k -bufsize ${BUF}k \
    -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*2)" \
    -pix_fmt yuv420p -movflags +faststart "$OUT/renditions/video_${NAME}p.mp4"
done

run_timed "audio_aac128" ffmpeg -nostdin -v error -y -i "$SRC" -vn -c:a aac -b:a 128k -ac 2 "$OUT/renditions/audio_128k.mp4"

# One combined run (decode once, all 1080p-and-below rungs + audio) = how a production job would actually run.
X264="-c:v libx264 -preset medium -profile:v high -g $GOP -keyint_min $GOP -sc_threshold 0 -pix_fmt yuv420p"
run_timed "combined_ladder_1080_down" ffmpeg -nostdin -v error -y -i "$SRC" \
  -filter_complex "[0:v]split=4[a][b][c][d];[a]scale=-2:1080:flags=lanczos[v1080];[b]scale=-2:720:flags=lanczos[v720];[c]scale=-2:480:flags=lanczos[v480];[d]scale=-2:360:flags=lanczos[v360]" \
  -map "[v1080]" $X264 -b:v 6000k -maxrate 6600k -bufsize 12000k -f mp4 "$OUT/renditions/_c1080.mp4" \
  -map "[v720]"  $X264 -b:v 3000k -maxrate 3300k -bufsize 6000k  -f mp4 "$OUT/renditions/_c720.mp4" \
  -map "[v480]"  $X264 -b:v 1500k -maxrate 1650k -bufsize 3000k  -f mp4 "$OUT/renditions/_c480.mp4" \
  -map "[v360]"  $X264 -b:v 800k  -maxrate 880k  -bufsize 1600k  -f mp4 "$OUT/renditions/_c360.mp4" \
  -map 0:a:0 -c:a aac -b:a 128k -ac 2 -f mp4 "$OUT/renditions/_caudio.mp4"
rm -f "$OUT"/renditions/_c*.mp4

ls -l "$OUT/renditions" | tee "$OUT/timing/rendition_sizes.txt"
