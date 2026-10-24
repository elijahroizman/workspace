#!/bin/sh
# run-drive.sh LIST OUT [drive flags]: runs the harness's drive over every file named in LIST,
# one process per file (8 GB address space, 120 s), 18 at a time, into OUT.
# Each file's result is one line; aborts and timeouts say so.
list=$1; out=$2; shift 2
D=$(dirname "$0")/harness/target/release/drive
export D FLAGS="$*"
tr '\n' '\0' < "$list" | xargs -0 -P 18 -n 1 sh -c '
  r=$( (ulimit -v 8000000; timeout 120 /usr/bin/time -f "MEM %M" $D $FLAGS "$0") 2>&1 )
  code=$?
  line=$(printf "%s\n" "$r" | grep -v "^MEM" | grep -P "^\Q$0\E\t" || true)
  mem=$(printf "%s\n" "$r" | grep "^MEM" | tail -1)
  if [ -z "$line" ]; then line="$0	DIED($code)	$(printf "%s" "$r" | grep -v "^MEM" | tr "\n" " " | cut -c1-300)"; fi
  printf "%s\t%s\n" "$line" "$mem"
' > "$out"
