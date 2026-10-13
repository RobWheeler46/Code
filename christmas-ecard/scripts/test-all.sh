#!/bin/sh
# Runs every test one after another and says which ones failed. A test fails if it exits with an error OR prints a line starting with FAIL
# (a few older tests could print FAIL and still exit 0). Run it on its own: tests share a data folder, so running other things at the same time can cause false failures.
cd "$(dirname "$0")/.." || exit 1
bad=0
for t in tests/*_test.php tests/smoke.php; do
  out=$(timeout 300 php "$t" 2>&1); code=$?
  if [ $code -ne 0 ] || printf '%s\n' "$out" | grep -q '^FAIL '; then echo "FAIL $t"; printf '%s\n' "$out" | grep '^FAIL ' | head -3; bad=1; fi
done
[ $bad -eq 0 ] && echo "All tests passed"
exit $bad
