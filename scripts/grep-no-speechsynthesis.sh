#!/usr/bin/env bash
# natally — speech-synthesis ban guard (D7a, TR-5; task V.2).
#
# Greps the app source trees for the banned Web Speech API surface
# (`speechSynthesis`) and exits 1 on any hit, 0 on none. R.7 (CI hook) calls
# this; it must also run standalone, from any working directory.
#
# Search path (normative: apps/**/src/**): each app's frontend src tree plus
# its Tauri src tree — for this repo that is apps/local/src and
# apps/local/src-tauri/src. Scanning those exact trees (not bare apps/) keeps
# node_modules' shipped lib.dom.d.ts out of the verdict. `.tmp/` probes can
# exercise the failing branch via SCAN_ROOT (see V.2 verify notes); SCAN_ROOT
# is relative to the repo root unless absolute.
set -u

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cd "${repo_root}" || {
  echo "grep-no-speechsynthesis: cannot reach repo root from ${script_dir}" >&2
  exit 2
}

roots=()
if [ -n "${SCAN_ROOT:-}" ]; then
  roots+=("${SCAN_ROOT}")
else
  # Only existing trees are scanned; a glob that matches nothing contributes
  # nothing (nullglob-style guard below keeps grep from erroring on literals).
  for candidate in apps/*/src apps/*/src-tauri/src; do
    [ -d "${candidate}" ] && roots+=("${candidate}")
  done
fi

if [ "${#roots[@]}" -eq 0 ]; then
  echo "grep-no-speechsynthesis: no source trees found to scan" >&2
  exit 2
fi

if [ ! -d "${roots[0]}" ]; then
  echo "grep-no-speechsynthesis: scan root '${roots[0]}' does not exist" >&2
  exit 2
fi

# -I skips binaries; ts/tsx covers the web trees, rs covers src-tauri.
hits="$(grep -RInE 'speechSynthesis' "${roots[@]}" --include='*.ts' --include='*.tsx' --include='*.rs' 2>/dev/null)"
status=$?

if [ "${status}" -eq 0 ]; then
  printf '%s\n' "${hits}"
  count="$(printf '%s\n' "${hits}" | wc -l)"
  echo "grep-no-speechsynthesis: ${count} hit(s) — the banned API surface is present (D7a, TR-5)" >&2
  exit 1
elif [ "${status}" -eq 1 ]; then
  echo "speechSynthesis: 0 hits"
  exit 0
else
  echo "grep-no-speechsynthesis: grep failed with status ${status}" >&2
  exit 2
fi
