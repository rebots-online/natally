#!/usr/bin/env bash
# R.1 / CC12 / INC-18: Linux AppImage + deb via tauri build, stamped into tracked dist/.
# Idempotent: skips when both artifacts for the current version already exist (--force overrides).
# Manual release surface: only this script builds, never an ad-hoc path (INC-18).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

force=0
dry=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --dry-run) dry=1 ;;
    *) echo "Usage: scripts/build-linux.sh [--dry-run] [--force]" >&2; exit 2 ;;
  esac
done

version="$(tr -d '[:space:]' < version.txt)"
appimage="dist/mba.robin.natally-v${version}-linux.AppImage"
deb="dist/mba.robin.natally-v${version}-linux.deb"

if [ "$dry" -eq 1 ]; then
  echo "linux: plan (re)stamp via scripts/update-version.sh (release.lock honoured when present), then --check"
  echo "linux: pnpm --filter @natally/local exec tauri build --bundles appimage,deb (frontend via its beforeBuildCommand; production env only — .env.development.local never loads)"
  echo "linux: artifacts -> ${appimage} and ${deb} (tracked dist/, slug-first per CC12)"
  [ "$force" -eq 1 ] && echo "linux: --force — existing artifacts at this version are not skipped (TC5: regenerate under a suffix, never overwrite)"
  exit 0
fi

if [ -f "$appimage" ] && [ -f "$deb" ] && [ "$force" -eq 0 ]; then
  echo "linux: v${version} artifacts already present; nothing to do (use --force to rebuild)"
  exit 0
fi

# One canonical stamp per handback (CC2), lock-aware, then verify surfaces agree.
bash scripts/update-version.sh
bash scripts/update-version.sh --check
version="$(tr -d '[:space:]' < version.txt)"
appimage="dist/mba.robin.natally-v${version}-linux.AppImage"
deb="dist/mba.robin.natally-v${version}-linux.deb"

if [ -f "$appimage" ] && [ -f "$deb" ] && [ "$force" -eq 0 ]; then
  echo "linux: stamp moved to v${version} whose artifacts already exist; nothing to do"
  exit 0
fi

mkdir -p dist
pnpm --filter @natally/local exec tauri build --bundles appimage,deb

bundle_appimage="$(find apps/local/src-tauri/target/release/bundle/appimage -maxdepth 1 -name '*.AppImage' -print -quit)"
bundle_deb="$(find apps/local/src-tauri/target/release/bundle/deb -maxdepth 1 -name '*.deb' -print -quit)"
[ -n "$bundle_appimage" ] || { echo "linux: tauri produced no AppImage" >&2; exit 1; }
[ -n "$bundle_deb" ] || { echo "linux: tauri produced no deb" >&2; exit 1; }

# TC5: never overwrite an existing stamped artifact in place — this build owns this stamp.
if [ -e "$appimage" ] || [ -e "$deb" ]; then
  echo "linux: refusing to overwrite existing v${version} artifacts (TC5); move them to ~/outbox/natally/ first or pass a fresh stamp" >&2
  exit 1
fi
cp "$bundle_appimage" "$appimage"
cp "$bundle_deb" "$deb"
echo "linux: staged ${appimage}"
echo "linux: staged ${deb}"
