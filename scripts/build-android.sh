#!/usr/bin/env bash
# R.3 / CC12 / INC-18: Android apk + aab via tauri android build.
# versionCode comes from version.json (MAJOR*100000+MINOR, the stamper's formula —
# R.3 acceptance). Requires ANDROID_HOME (NDK installed) and JDK 17+.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

force=0
dry=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --dry-run) dry=1 ;;
    *) echo "Usage: scripts/build-android.sh [--dry-run] [--force]" >&2; exit 2 ;;
  esac
done

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
if [ ! -d "$ANDROID_HOME/ndk" ]; then
  echo "android: ANDROID_HOME ($ANDROID_HOME) has no NDK; install via sdkmanager first" >&2
  exit 2
fi

version="$(tr -d '[:space:]' < version.txt)"
code="$(python3 -c "import json;print(json.load(open('version.json'))['versionCode'])")"
apk="dist/mba.robin.natally-v${version}-android.apk"
aab="dist/mba.robin.natally-v${version}-android.aab"

if [ "$dry" -eq 1 ]; then
  echo "android: plan (re)stamp; tauri android build (apk + aab); versionCode ${code} from version.json (MAJOR*100000+MINOR)"
  echo "android: artifacts -> ${apk} and ${aab}"
  exit 0
fi

if [ -f "$apk" ] && [ -f "$aab" ] && [ "$force" -eq 0 ]; then
  echo "android: v${version} artifacts already present; nothing to do (use --force to rebuild)"
  exit 0
fi

bash scripts/update-version.sh
bash scripts/update-version.sh --check
version="$(tr -d '[:space:]' < version.txt)"
code="$(python3 -c "import json;print(json.load(open('version.json'))['versionCode'])")"
apk="dist/mba.robin.natally-v${version}-android.apk"
aab="dist/mba.robin.natally-v${version}-android.aab"
if [ -e "$apk" ] || [ -e "$aab" ]; then
  echo "android: refusing to overwrite existing v${version} artifacts (TC5)" >&2
  exit 1
fi

if [ ! -d apps/local/src-tauri/gen/android ]; then
  echo "android: initializing tauri android project (gen/android)"
  pnpm --filter @natally/local exec tauri android init
fi

mkdir -p dist
pnpm --filter @natally/local exec tauri android build --apk --aab

bundle_apk="$(find apps/local/src-tauri/gen/android -name '*.apk' -path '*universal*' -print -quit)"
[ -n "$bundle_apk" ] || bundle_apk="$(find apps/local/src-tauri/gen/android -name '*arm64*.apk' -print -quit)"
bundle_aab="$(find apps/local/src-tauri/gen/android -name '*.aab' -print -quit)"
[ -n "$bundle_apk" ] && [ -f "$bundle_apk" ] || { echo "android: no apk produced" >&2; exit 1; }
[ -n "$bundle_aab" ] && [ -f "$bundle_aab" ] || { echo "android: no aab produced" >&2; exit 1; }
cp "$bundle_apk" "$apk"
cp "$bundle_aab" "$aab"
echo "android: staged ${apk} (versionCode ${code})"
echo "android: staged ${aab}"
