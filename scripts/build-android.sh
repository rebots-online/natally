#!/usr/bin/env bash
# =============================================================================
# scripts/build-android.sh — natally Android builder (apk + aab)
# Checklist R.3. ARCHITECTURE.md §14: `build-android.sh` (apk, aab); artifacts
# `mba.robin.natally-v<MAJOR.MINOR.BUILD>-<qualifier>` staged into tracked `dist/`
# (AGENTS.md slug-first naming).
#
# Real path (exactly once, never under --dry-run):
#   scripts/update-version.sh                                 (default stamp mode, pre-build —
#                                                              no-op when the tree is consistent)
#   pnpm --filter @natally/local exec tauri android build --aab
#                                                              (--aab builds the aab in addition
#                                                              to the apk; tauri drives gradle)
#   → dist/mba.robin.natally-v<version>-android.apk
#   → dist/mba.robin.natally-v<version>-android.aab
#
# versionCode: MAJOR*100000 + MINOR (BUILD excluded — Play needs monotonic).
# The R.6-hardened stamper (scripts/update-version.sh:207) already computes this
# and exports PROJECT_VERSION/PROJECT_VERSION_CODE — but only in its write modes:
# sourcing it would perform a full stamp write, which --dry-run must never do.
# So this script RECOMPUTES the value identically from the stamp source
# version.txt (same split, same digit validation, same octal-safe leading-zero
# strip), then — real build only, after the pre-build stamp has converged every
# target — cross-checks the recomputed value against version.json's
# "versionCode" and fails hard on divergence.
#
# Prerequisites (JDK / Android SDK / NDK / tauri android gen) are checked ONLY
# at real-build time, each with an exact missing-piece message. --dry-run never
# checks them and never invokes gradle, tauri, or pnpm: it prints the artifact
# names for the current version, the versionCode computation line, and the
# stamp plan, then exits 0.
#
# Idempotent: when dist/ already holds BOTH artifacts for the current version,
# the build is skipped entirely unless --force (per-artifact staging likewise).
# Never deletes anything; no git operations (house rules).
#
# Usage:
#   scripts/build-android.sh [--dry-run] [--force]
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

PACKAGE_NAME="mba.robin.natally"   # must equal update-version.sh / tauri identifier exactly
APP_DIR="apps/local"
GEN_DIR="$APP_DIR/src-tauri/gen/android"
GEN_OUTPUTS="$GEN_DIR/app/build/outputs"
DIST_DIR="dist"

usage() {
  cat <<'USAGE'
[build-android] usage: scripts/build-android.sh [--dry-run] [--force]
  (default)      real build: pre-build stamp → tauri android build (apk+aab) → stage into dist/
  --dry-run      print artifact names, versionCode computation, stamp plan — checks nothing, builds nothing
  --force        re-stage even when dist/ already holds this version's artifacts
USAGE
}

DRY_RUN=0
FORCE=0
for _arg in "$@"; do
  case "$_arg" in
    --dry-run) DRY_RUN=1 ;;
    --force)   FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    *)         usage >&2; echo "[build-android] unknown option: ${_arg}" >&2; exit 2 ;;
  esac
done

# --- version + versionCode (mirrors scripts/update-version.sh stamp parsing) -
# version.txt is the single stamp source; version.json is its first target.
STAMP_VERSION="$(tr -d '[:space:]' < "$PROJECT_ROOT/version.txt" 2>/dev/null || true)"
if [ -z "$STAMP_VERSION" ]; then
  echo "[build-android] version.txt absent or empty — no stamp source; run scripts/update-version.sh first" >&2
  exit 1
fi

STAMP_MAJOR="$(printf '%s' "$STAMP_VERSION" | cut -d. -f1)"
STAMP_MINOR="$(printf '%s' "$STAMP_VERSION" | cut -d. -f2)"
STAMP_BUILD="$(printf '%s' "$STAMP_VERSION" | cut -d. -f3)"

malformed_stamp() {
  echo "[build-android] version.txt malformed: '${STAMP_VERSION}' — expected MAJOR.MINOR.BUILD" >&2
}
if [ -z "$STAMP_BUILD" ]; then malformed_stamp; exit 1; fi
for _f in "$STAMP_MAJOR" "$STAMP_MINOR"; do
  case "$_f" in ''|*[!0-9]*) malformed_stamp >&2; exit 1 ;; esac
done
# leading zeros must never meet bash arithmetic (octal trap) — same guard as the stamper
MAJOR_DIGITS="$(printf '%s' "$STAMP_MAJOR" | sed 's/^0*//')"; MAJOR_DIGITS="${MAJOR_DIGITS:-0}"
MINOR_DIGITS="$(printf '%s' "$STAMP_MINOR" | sed 's/^0*//')"; MINOR_DIGITS="${MINOR_DIGITS:-0}"
case "${MAJOR_DIGITS}${MINOR_DIGITS}" in *[!0-9]*) malformed_stamp >&2; exit 1 ;; esac

# Identical formula to scripts/update-version.sh:207 — see header for why not sourced.
VERSION_CODE=$(( MAJOR_DIGITS * 100000 + MINOR_DIGITS ))
CODE_LINE="versionCode = MAJOR*100000 + MINOR = ${STAMP_MAJOR}*100000 + ${STAMP_MINOR} = ${VERSION_CODE}"

ART_APK="$DIST_DIR/${PACKAGE_NAME}-v${STAMP_VERSION}-android.apk"
ART_AAB="$DIST_DIR/${PACKAGE_NAME}-v${STAMP_VERSION}-android.aab"

# --- --dry-run: plan only -----------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[build-android] dry-run — version ${STAMP_VERSION}"
  echo "[build-android] ${CODE_LINE}   (recomputed identically to scripts/update-version.sh:207; stamper not sourced — sourcing it would stamp-write)"
  echo "[build-android] artifacts:"
  if [ -f "$ART_APK" ]; then
    echo "[build-android]   $ART_APK (already staged — would skip without --force)"
  else
    echo "[build-android]   $ART_APK"
  fi
  if [ -f "$ART_AAB" ]; then
    echo "[build-android]   $ART_AAB (already staged — would skip without --force)"
  else
    echo "[build-android]   $ART_AAB"
  fi
  echo "[build-android] stamp plan: scripts/update-version.sh (default stamp mode) pre-build — no-op when the tree is already consistent"
  echo "[build-android] real path: pnpm --filter @natally/local exec tauri android build --aab  (not invoked in dry-run)"
  exit 0
fi

# --- real build: idempotence first --------------------------------------------
if [ -f "$ART_APK" ] && [ -f "$ART_AAB" ] && [ "$FORCE" -eq 0 ]; then
  echo "[build-android] $ART_APK and $ART_AAB already staged for v${STAMP_VERSION} — skipping build (use --force to re-stage)"
  exit 0
fi

# --- real build: prerequisites (exact missing-piece messages) -----------------
need() {  # $1 missing piece, $2 remedy — prints exact message and aborts
  echo "[build-android] missing prerequisite: $1 — $2" >&2
  exit 1
}
command -v pnpm >/dev/null 2>&1 \
  || need "pnpm" "install pnpm (corepack enable pnpm) and run pnpm install at the repo root"
[ -d "$PROJECT_ROOT/$APP_DIR/src-tauri" ] \
  || need "$APP_DIR/src-tauri" "tauri project absent — the Android target cannot be built before it exists"
[ -d "$PROJECT_ROOT/$GEN_DIR" ] \
  || need "$GEN_DIR" "run: pnpm --filter @natally/local exec tauri android init"
[ -n "${JAVA_HOME:-}" ] && command -v javac >/dev/null 2>&1 \
  || need "JDK (JAVA_HOME + javac on PATH)" "install JDK 17+ and export JAVA_HOME"
[ -n "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ] \
  || need "Android SDK (ANDROID_HOME or ANDROID_SDK_ROOT)" "install the Android SDK and export ANDROID_HOME"
SDK_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -d "$SDK_HOME/platform-tools" ] \
  || need "Android SDK platform-tools under $SDK_HOME" "run sdkmanager 'platform-tools' (or fix ANDROID_HOME)"
if [ -n "${NDK_HOME:-}" ]; then
  [ -d "$NDK_HOME" ] || need "NDK at NDK_HOME=$NDK_HOME" "install the NDK via sdkmanager 'ndk;...' or fix NDK_HOME"
else
  ls "$SDK_HOME"/ndk/*/ >/dev/null 2>&1 \
    || need "Android NDK (NDK_HOME unset and no $SDK_HOME/ndk/*)" "install the NDK via sdkmanager 'ndk;...' and export NDK_HOME"
fi

# --- real build: pre-build stamp (default stamp mode) -------------------------
echo "[build-android] pre-build stamp:"
bash "$PROJECT_ROOT/scripts/update-version.sh"

# versionCode from version.json — hard cross-check now that the stamp converged
VJ_CODE="$(sed -n 's/.*"versionCode"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$PROJECT_ROOT/version.json" 2>/dev/null | head -n1 || true)"
if [ -z "$VJ_CODE" ]; then
  need "version.json with a numeric versionCode" "scripts/update-version.sh should have written it — investigate the stamper"
fi
if [ "$VJ_CODE" != "$VERSION_CODE" ]; then
  echo "[build-android] versionCode divergence: version.json says ${VJ_CODE}, recomputed from version.txt is ${VERSION_CODE} — refusing to build" >&2
  exit 1
fi
echo "[build-android] ${CODE_LINE} (matches version.json)"

# --- real build ---------------------------------------------------------------
echo "[build-android] building: pnpm --filter @natally/local exec tauri android build --aab"
pnpm --filter @natally/local exec tauri android build --aab

# --- stage newest produced apk/aab into dist/ (slug-first) ---------------------
find_newest() {  # $1 name glob → newest file under $GEN_OUTPUTS (mtime-sorted), empty if none
  find "$PROJECT_ROOT/$GEN_OUTPUTS" -type f -name "$1" -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -n1 | cut -d' ' -f2-
}
stage() {  # $1 source path, $2 dist destination
  local src="$1" dst="$2"
  if [ -z "$src" ]; then
    echo "[build-android] no artifact matched for $dst — tauri android build produced no expected output under $GEN_OUTPUTS" >&2
    exit 1
  fi
  if [ -f "$dst" ] && [ "$FORCE" -eq 0 ]; then
    echo "[build-android] $dst already staged — skipped (use --force to re-stage)"
  else
    mkdir -p "$PROJECT_ROOT/$DIST_DIR"
    cp "$src" "$dst"
    echo "[build-android] staged $dst  (from $src)"
  fi
}

APK_SRC="$(find_newest 'app-universal-release.apk')"
[ -z "$APK_SRC" ] && APK_SRC="$(find_newest '*.apk')"
AAB_SRC="$(find_newest 'app-universal-release.aab')"
[ -z "$AAB_SRC" ] && AAB_SRC="$(find_newest '*.aab')"

stage "$APK_SRC" "$PROJECT_ROOT/$ART_APK"
stage "$AAB_SRC" "$PROJECT_ROOT/$ART_AAB"

echo "[build-android] done: v${STAMP_VERSION} (versionCode ${VERSION_CODE}) staged in $DIST_DIR/"
