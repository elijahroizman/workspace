#!/bin/sh
# fuzz-loop.sh SEEDS OUT THREADS TOTAL_SECONDS: runs the harness's fuzz binary, restarting it
# after a hang or an abort (out of memory, stack overflow) and keeping the inputs it was running
# as OUT/suspect-*. 8 GB address space.
seeds=$1; out=$2; threads=$3; total=$4
F=$(dirname "$0")/harness/target/release/fuzz
mkdir -p "$out"
end=$(( $(date +%s) + total ))
while [ "$(date +%s)" -lt "$end" ]; do
  left=$(( end - $(date +%s) ))
  rm -f "$out"/cur-*
  (ulimit -v 8000000; ulimit -s 8192; RUST_MIN_STACK=8388608 "$F" "$seeds" "$out" "$threads" "$left") 2>> "$out/log.txt"
  code=$?
  if [ $code -ne 0 ] && [ $code -ne 3 ]; then
    t=$(date +%s)
    echo "exit $code at $t" >> "$out/log.txt"
    for c in "$out"/cur-*; do [ -f "$c" ] && cp "$c" "$out/suspect-$t-$(basename "$c" | sed s/^cur-//)"; done
  fi
done
