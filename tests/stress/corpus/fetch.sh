#!/usr/bin/env bash
set -euo pipefail
corpus_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
dest="${1:-$HOME/stress-corpus-files}"
mkdir -p -- "$dest"
while IFS=$'\t' read -r name url hash note category bytes; do
  [[ "$name" == file || -z "$name" ]] && continue
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ && "$name" != .* ]] || { echo "Unsafe filename: $name" >&2; exit 1; }
  if [[ -f "$dest/$name" ]] && printf '%s  %s\n' "$hash" "$dest/$name" | sha256sum --check --status; then
    continue
  fi
  tmp="$(mktemp "$dest/.download.XXXXXXXX")"
  if [[ "$url" == generated:* ]]; then
    cp -- "$corpus_dir/files/$name" "$tmp"
  else
    curl --fail --location --retry 2 --max-time 180 --proto '=https' --proto-redir '=https' "$url" --output "$tmp"
  fi
  if ! printf '%s  %s\n' "$hash" "$tmp" | sha256sum --check --status; then
    rm -f -- "$tmp"
    echo "Hash mismatch: $name. Source may have changed; do not silently update the manifest." >&2
    exit 1
  fi
  mv -- "$tmp" "$dest/$name"
done < "$corpus_dir/manifest.tsv"
