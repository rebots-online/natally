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
  echo "android: plan (re)stamp; tauri android build; production-sign + verify apk and aab; versionCode ${code} from version.json (MAJOR*100000+MINOR)"
  echo "android: artifacts -> ${apk} and ${aab}"
  exit 0
fi

for key in \
  NATALLY_ANDROID_KEYSTORE_PATH \
  NATALLY_ANDROID_KEYSTORE_PASSWORD \
  NATALLY_ANDROID_KEY_ALIAS \
  NATALLY_ANDROID_KEY_PASSWORD; do
  [ -n "${!key:-}" ] || { echo "android: required signing variable ${key} is missing" >&2; exit 2; }
done
[ -f "$NATALLY_ANDROID_KEYSTORE_PATH" ] || {
  echo "android: signing keystore does not exist: ${NATALLY_ANDROID_KEYSTORE_PATH}" >&2
  exit 2
}
build_tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
apksigner="$build_tools/apksigner"
[ -x "$apksigner" ] || { echo "android: apksigner is unavailable under ${build_tools}" >&2; exit 2; }

verify_android_artifacts() {
  "$apksigner" verify --verbose "$apk" >/dev/null
  # Capture producer output before grepping: an early-exit grep (-q) on a live
  # pipe SIGPIPEs the producer, which pipefail then reports as exit 141.
  local listing jars
  listing="$(unzip -Z1 "$aab")"
  grep -Eq '^META-INF/[^/]+\.(RSA|DSA|EC)$' <<<"$listing"
  jars="$(jarsigner -verify "$aab" 2>&1)"
  grep -q 'jar verified' <<<"$jars"
}

if [ -f "$apk" ] && [ -f "$aab" ] && [ "$force" -eq 0 ]; then
  verify_android_artifacts || {
    echo "android: existing v${version} artifacts are not correctly signed" >&2
    exit 1
  }
  echo "android: v${version} signed artifacts already present and verified; nothing to do (use --force to rebuild)"
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
# rustc segfaulted in thin-LTO with all four ABIs in parallel (memory pressure):
# raise the stack, cap cargo jobs, and build aarch64 only by default — every
# shipping Android device is arm64; other ABIs come with a bigger-RAM host or
# per-target invocations.
export RUST_MIN_STACK=16777216
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
android_targets="${NATALLY_ANDROID_TARGETS:-aarch64}"
pnpm --filter @natally/local exec tauri android build --apk --aab --target "$android_targets"

bundle_apk="$(find apps/local/src-tauri/gen/android -name '*.apk' -path '*universal*' -print -quit)"
[ -n "$bundle_apk" ] || bundle_apk="$(find apps/local/src-tauri/gen/android -name '*arm64*.apk' -print -quit)"
bundle_aab="$(find apps/local/src-tauri/gen/android -name '*.aab' -print -quit)"
[ -n "$bundle_apk" ] && [ -f "$bundle_apk" ] || { echo "android: no apk produced" >&2; exit 1; }
[ -n "$bundle_aab" ] && [ -f "$bundle_aab" ] || { echo "android: no aab produced" >&2; exit 1; }
"$apksigner" sign \
  --ks "$NATALLY_ANDROID_KEYSTORE_PATH" \
  --ks-key-alias "$NATALLY_ANDROID_KEY_ALIAS" \
  --ks-pass env:NATALLY_ANDROID_KEYSTORE_PASSWORD \
  --key-pass env:NATALLY_ANDROID_KEY_PASSWORD \
  --v4-signing-enabled false \
  --out "$apk" \
  "$bundle_apk"
jarsigner \
  -keystore "$NATALLY_ANDROID_KEYSTORE_PATH" \
  -storepass:env NATALLY_ANDROID_KEYSTORE_PASSWORD \
  -keypass:env NATALLY_ANDROID_KEY_PASSWORD \
  -signedjar "$aab" \
  "$bundle_aab" \
  "$NATALLY_ANDROID_KEY_ALIAS" >/dev/null
verify_android_artifacts
echo "android: staged and verified production-signed ${apk} (versionCode ${code})"
echo "android: staged and verified production-signed ${aab}"
