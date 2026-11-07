#!/usr/bin/env bash
# Upload media to the CDN bucket under content-hashed, never-overwritten keys.
#
#   aws-vault exec medic -- script/upload_media.sh DIR FILE...
#   aws-vault exec medic -- script/upload_media.sh videos media/drive-in.av1.mp4 media/drive-in.h264.mp4
#
# FILE drive-in.av1.mp4 becomes DIR/drive-in.<first 12 hex of its sha256>.av1.mp4, so the same bytes
# always get the same URL and different bytes a new one. A key that already exists is left alone.
# Prints one "<file>\t<url>" line per file, ready for the data files.
set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 64
fi

dir=${1%/}
shift
root=$(cd "$(dirname "$0")/.." && pwd)
outputs=$(cd "$root/infra" && mise exec -- pulumi stack output --stack prod --json)
bucket=$(printf '%s' "$outputs" | node -e 'process.stdin.on("data", d => process.stdout.write(JSON.parse(d).bucketName))')
origin=$(printf '%s' "$outputs" | node -e 'process.stdin.on("data", d => process.stdout.write(JSON.parse(d).mediaOrigin))')

content_type() {
  case "${1##*.}" in
    mp4) echo video/mp4 ;;
    webm) echo video/webm ;;
    mp3) echo audio/mpeg ;;
    ogg|oga) echo audio/ogg ;;
    m4a) echo audio/mp4 ;;
    webp) echo image/webp ;;
    avif) echo image/avif ;;
    jpg|jpeg) echo image/jpeg ;;
    png) echo image/png ;;
    *) echo "unsupported extension: $1" >&2; return 1 ;;
  esac
}

for file in "$@"; do
  type=$(content_type "$file")
  name=$(basename "$file")
  stem=${name%%.*}
  rest=${name#"$stem"}
  hash=$(shasum -a 256 "$file" | cut -c1-12)
  key="$dir/$stem.$hash$rest"

  # A conditional put: S3 refuses it with 412 when the key exists, so no key is ever overwritten, even when a
  # failed lookup (expired credentials, a network error) would otherwise read as "absent".
  if aws s3api head-object --bucket "$bucket" --key "$key" >/dev/null 2>&1; then
    echo "exists: $key" >&2
  elif output=$(aws s3api put-object --bucket "$bucket" --key "$key" --body "$file" --if-none-match '*' \
      --content-type "$type" --cache-control "public, max-age=31536000, immutable" 2>&1); then
    echo "uploaded: $key" >&2
  elif [[ $output == *PreconditionFailed* || $output == *412* ]]; then
    echo "exists: $key" >&2
  else
    echo "$output" >&2
    exit 1
  fi
  printf '%s\t%s/%s\n' "$file" "$origin" "$key"
done
