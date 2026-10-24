#!/usr/bin/env bash
# Run from the rsynced checkout on bbb. This script intentionally builds there.
set -euo pipefail
export PATH="$HOME/.local/node24/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
corpus_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd -- "$corpus_dir/../../.." && pwd)"
cd "$repo"
"$corpus_dir/fetch.sh" "${CORPUS_FILES:-$HOME/stress-corpus-files}"
npm ci
ln -sfn "$HOME/shots/node_modules/playwright" node_modules/playwright
ln -sfn "$HOME/shots/node_modules/playwright-core" node_modules/playwright-core
node scripts/engine.mjs
VITE_TEST_HOOKS=1 npx vite build
ln -sfn "${CORPUS_FILES:-$HOME/stress-corpus-files}" dist/dev-samples
(cd crates && cargo build --release -p office-core --features cli --bin officec)
mkdir -p "$corpus_dir/results"
if curl -fsS http://127.0.0.1:1443/ > /dev/null 2>&1; then
  echo "Port 1443 is already in use. Stop that preview before running the full build." >&2
  exit 1
fi
npx vite preview --host 127.0.0.1 --port 1443 --strictPort > "$corpus_dir/results/preview.log" 2>&1 &
preview_pid=$!
trap 'kill "$preview_pid" 2>/dev/null || true' EXIT
for i in {1..50}; do
  curl -fsS http://127.0.0.1:1443/ > /dev/null 2>&1 && break
  sleep 0.2
done
kill -0 "$preview_pid"
node "$corpus_dir/browser.mjs"
python3 "$corpus_dir/structure.py" --files "${CORPUS_FILES:-$HOME/stress-corpus-files}"
python3 "$corpus_dir/values.py"
node "$corpus_dir/audit-pages.mjs"
uv run --with pypdf --with fonttools "$corpus_dir/pdf-audit.py"
python3 "$corpus_dir/signatures.py"
if [[ -n "${SOFFICE:-}" ]] || command -v soffice > /dev/null; then
  python3 "$corpus_dir/reference.py" --files "${CORPUS_FILES:-$HOME/stress-corpus-files}"
fi
