#!/usr/bin/env bash
set -euo pipefail

# Anchor to this checkout, including when invoked from another working directory.
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$root"
if [[ ! -d apps ]]; then
  printf '%s\n' 'speechSynthesis: apps directory missing' >&2
  exit 2
fi

# Bash globbing includes ignored/untracked sources and dot-directories. Never
# scan only git-tracked files: a newly introduced violation must fail immediately.
shopt -s globstar nullglob dotglob
files=(apps/**/src/**/*.ts apps/**/src/**/*.tsx apps/**/src/**/*.rs)
if (( ${#files[@]} == 0 )); then
  printf '%s\n' 'speechSynthesis: 0 hits'
  exit 0
fi
status=0
grep -nHF -- 'speechSynthesis' "${files[@]}" || status=$?
case "$status" in
  0) printf '%s\n' 'speechSynthesis: forbidden reference found' >&2; exit 1 ;;
  1) printf '%s\n' 'speechSynthesis: 0 hits' ;;
  *) exit "$status" ;;
esac
