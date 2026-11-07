#!/usr/bin/env bash
# Needs ffmpeg built with libsvtav1 and libx264.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 INPUT NAME [START_SECONDS] [LENGTH_SECONDS] [CROSSFADE_SECONDS] [HEIGHT]" >&2
  echo "writes media/NAME.av1.mp4 and media/NAME.h264.mp4, a silent loop LENGTH - CROSSFADE long" >&2
  exit 1
fi

input=$1
name=$2
start=${3:-0}
length=${4:-30}
crossfade=${5:-2}
height=${6:-1080}

out_dir="$(dirname "$0")/../media"
mkdir -p "$out_dir"

body=$(echo "$length - $crossfade" | bc -l)
offset=$(echo "$length - 2 * $crossfade" | bc -l)

# The loop starts CROSSFADE seconds into the excerpt and ends by fading into the excerpt's first CROSSFADE
# seconds, which run up to the same frame the loop starts on.
loop_filter="[0:v]trim=start=${start}:duration=${length},setpts=PTS-STARTPTS,fps=30,scale=-2:${height}:flags=lanczos,format=yuv420p,split[excerpt][again];
[again]trim=duration=${crossfade},setpts=PTS-STARTPTS[head];
[excerpt]trim=start=${crossfade},setpts=PTS-STARTPTS[body];
[body][head]xfade=transition=fade:duration=${crossfade}:offset=${offset},format=yuv420p[loop]"

ffmpeg -hide_banner -loglevel warning -y -i "$input" -filter_complex "$loop_filter" -map "[loop]" -an \
  -c:v libsvtav1 -preset 5 -crf 38 -g 240 -svtav1-params tune=0 -movflags +faststart \
  "$out_dir/$name.av1.mp4"

ffmpeg -hide_banner -loglevel warning -y -i "$input" -filter_complex "$loop_filter" -map "[loop]" -an \
  -c:v libx264 -preset slow -crf 23 -profile:v high -level 4.1 -g 240 -movflags +faststart \
  "$out_dir/$name.h264.mp4"

echo "wrote $out_dir/$name.av1.mp4 and $out_dir/$name.h264.mp4 (${body}s loop)"
