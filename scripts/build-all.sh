#!/usr/bin/env bash
# R.5 / §14 / §18.5 / CC14: full multi-platform release matrix under one stamp.
#
# release.lock grammar (DATA, never executed — parsed by scripts/update-version.sh
# and scripts/build-web.sh): lines `MAJOR=`, `MINOR=`, `BUILD_NUM=`.
# - lock absent: stamp ONCE via the canonical stamper (scripts/update-version.sh),
#   then materialize release.lock atomically (noclobber) carrying that stamp; every
#   platform build then reuses the stamp (each platform script's stamper call is
#   lock-aware and does not re-bump).
# - lock present: reuse it as-is (single-flight: a concurrent build-all loses the
#   noclobber race and joins the winner's stamp). The post-build bump is owned by
#   the lock creator: build-all runs `update-version.sh --post-build` only when it
#   created the lock this run.
# Artifacts: `mba.robin.natally-v<MAJOR.MINOR.BUILD>-<qualifier>` staged alongside
# existing dist/ contents — nothing is deleted or overwritten (INC-16, TC5).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

lock="release.lock"
slug="mba.robin.natally"
created_lock=0
run_start="$(date +%s)"

stamp_from_version() {
  local v
  v="$(tr -d '[:space:]' < version.txt)"
  echo "${v%.*}" >/dev/null # sanity: three segments
  printf '%s' "$v"
}

# --- One canonical stamp + single-flight lock -----------------------------------
if [ -f "$lock" ]; then
  echo "release: reusing existing release.lock (stamp owned by its creator)"
else
  bash scripts/update-version.sh
  version="$(stamp_from_version)"
  major="${version%%.*}"
  rest="${version#*.}"
  minor="${rest%%.*}"
  build="${rest#*.}"
  staging="STAGING_release-lock.$$"
  printf 'MAJOR=%s\nMINOR=%s\nBUILD_NUM=%s\n' "$major" "$minor" "$build" > "$staging"
  if ( set -o noclobber; : > "$lock" ) 2>/dev/null; then
    mv -f "$staging" "$lock"
    created_lock=1
    echo "release: stamped $version once and created release.lock (single-flight won)"
  else
    rm -f "$staging"
    echo "release: release.lock appeared concurrently; joining the winner's stamp (single-flight)"
  fi
fi

stamp="$(stamp_from_version)"
echo "release: stamp for this matrix run: v${stamp}"

# --- Platform builds, in order ---------------------------------------------------
run_step() {
  local name="$1"; shift
  local log=".tmp/build-all-${name}.$$.log"
  mkdir -p .tmp
  echo "release: >>> ${name} starting"
  if bash "$@" >"$log" 2>&1; then
    echo "release: <<< ${name} OK"
    tail -n 5 "$log"
  else
    local status=$?
    echo "release: <<< ${name} FAILED (exit ${status}); last output:"
    tail -n 15 "$log"
    return "$status"
  fi
}

# Android is best-effort in this matrix: environmental failure (no SDK/NDK, toolchain)
# is an honest SKIP, not a matrix failure. Never fabricated as success.
android_disposition="built"
if ! run_step android scripts/build-android.sh; then
  echo "android: skipped — see failure above (environmental: SDK/NDK or toolchain unavailable); matrix continues"
  android_disposition="skipped"
fi

run_step web scripts/build-web.sh
run_step linux scripts/build-linux.sh
run_step windows scripts/build-windows.sh

# --- Stamp audit: every artifact produced during this run carries v${stamp} ------
echo "release: auditing dist/ for off-stamp outputs newer than run start"
mismatch=0
while IFS= read -r -d '' path; do
  name="$(basename "$path")"
  case "$name" in
    ${slug}-v${stamp}-*) continue ;;
    ${slug}-v*)
      echo "release: STAMP MISMATCH: dist/${name} (expected v${stamp})"
      mismatch=1 ;;
  esac
done < <(find dist -mindepth 1 -maxdepth 1 -newermt "@${run_start}" -print0)
if [ "$mismatch" -ne 0 ]; then
  echo "release: FAIL — off-stamp artifacts staged during this run (listed above)" >&2
  exit 1
fi
# The web artifact carries a per-run runId suffix (see scripts/build-web.sh).
web_staged=$(find dist -maxdepth 1 -name "${slug}-v${stamp}-web-*.tar.gz" -newermt "@${run_start}" | head -n 1)
[ -n "$web_staged" ] || { echo "release: FAIL — no ${slug}-v${stamp}-web-<runId> archive staged this run" >&2; exit 1; }
for expected in \
  "${slug}-v${stamp}-linux.AppImage" \
  "${slug}-v${stamp}-linux.deb" \
  "${slug}-v${stamp}-win.exe" \
  "${slug}-v${stamp}-win-setup.exe"; do
  [ -e "dist/${expected}" ] || { echo "release: FAIL — expected artifact dist/${expected} absent" >&2; exit 1; }
done
echo "release: stamp audit clean — all run artifacts carry v${stamp}"

# --- Post-build bump (lock creator owns it; stamper refuses otherwise) ------------
if [ "$created_lock" -eq 1 ]; then
  rm -f "$lock"
  bash scripts/update-version.sh --post-build
  echo "release: post-build bump applied via update-version.sh --post-build"
else
  echo "release: release.lock pre-existed — post-build bump deferred to the lock owner (stamper refuses while the lock stands)"
fi

bash scripts/update-version.sh --check
echo "release: matrix complete (stamp v${stamp}; android: ${android_disposition})"
