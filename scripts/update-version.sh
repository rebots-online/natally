#!/usr/bin/env bash
# =============================================================================
# scripts/update-version.sh — natally version stamper
# Instance of ~/Admin-Manual/versioning/update-version.sh (BUILD_CONVENTIONS
# § Versioning). The bump lives INSIDE the stamper: MINOR increments
# unconditionally on every invocation; BUILD = epoch-minutes % 100000.
#
#   versionName = MAJOR.MINOR.BUILD      (e.g. 1.12.06942)
#   versionCode = MAJOR*100000 + MINOR   (BUILD excluded — Play needs monotonic)
#
# Modes:
#   (default)      stamp: bump MINOR, write version.txt + version.json + manifests
#   --post-build   consume the attestation of a SUCCESSFUL build: bump again so the
#                  tree never rests at a shipped stamp; refuses under release.lock
#                  (the matrix orchestrator owns the single post-set bump)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

PRODUCT_NAME="natally"
INTERNAL_NAME="natally"
PACKAGE_NAME="mba.robin.natally"   # must equal tauri.conf.json identifier / applicationId exactly

LOCK_FILE="$PROJECT_ROOT/release.lock"
MODE="${1:-stamp}"

if [ "$MODE" = "--post-build" ]; then
  if [ -f "$LOCK_FILE" ]; then
    echo "[update-version] --post-build refused: release.lock present — matrix in flight, orchestrator owns the bump" >&2
    exit 1
  fi
  BUILT="$(tr -d '[:space:]' < version.txt 2>/dev/null || echo unknown)"
  echo "[update-version] consuming the attestation of ${BUILT} (built) — incrementing the tree"
fi

if [ -f "$LOCK_FILE" ]; then
  echo "[update-version] Using frozen release.lock values"
  # shellcheck source=/dev/null
  source "$LOCK_FILE" # sets MAJOR, MINOR, BUILD_NUM
else
  CURRENT_VERSION=$(tr -d '[:space:]' < version.txt 2>/dev/null || echo "1.0.0")
  CURRENT_MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
  CURRENT_MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
  MAJOR="$CURRENT_MAJOR"            # manual milestone: hand-edit version.txt once per milestone
  MINOR=$((CURRENT_MINOR + 1))      # THE heartbeat — never remove
  BUILD_NUM=$(( $(date +%s) / 60 % 100000 ))
fi

BUILD_PADDED="$(printf '%05d' "${BUILD_NUM}")"
DISPLAY_VERSION="${MAJOR}.${MINOR}.${BUILD_PADDED}"
VERSION_CODE=$(( MAJOR * 100000 + MINOR ))

# Shipped-collision note: never silently reuse a stamp that already has artifacts in dist/
if ls "$PROJECT_ROOT"/dist/*"-v${DISPLAY_VERSION}-"* >/dev/null 2>&1; then
  echo "[update-version] NOTE: dist/ already holds artifacts stamped v${DISPLAY_VERSION} — shipped-stamp collision" >&2
fi

echo "Stamping version: ${DISPLAY_VERSION}  (versionCode: ${VERSION_CODE})"

echo "${DISPLAY_VERSION}" > version.txt
cat > version.json << JSON
{
  "version": "${DISPLAY_VERSION}",
  "versionBase": "${MAJOR}.${MINOR}",
  "buildNumber": "${BUILD_PADDED}",
  "versionCode": ${VERSION_CODE},
  "buildDate": "$(date -Iseconds)",
  "productName": "${PRODUCT_NAME}",
  "internalName": "${INTERNAL_NAME}",
  "packageName": "${PACKAGE_NAME}"
}
JSON

# Manifests the project has (each guarded)
[ -f package.json ] && command -v jq >/dev/null && {
  jq --arg v "${DISPLAY_VERSION}" '.version = $v' package.json > package.json.tmp
  mv package.json.tmp package.json
}
[ -f src-tauri/tauri.conf.json ] && \
  sed -i 's/"version": "[^"]*"/"version": "'"${DISPLAY_VERSION}"'"/' src-tauri/tauri.conf.json
[ -f src-tauri/Cargo.toml ] && \
  sed -i '0,/^version *= *"[^"]*"/s//version = "'"${DISPLAY_VERSION}"'"/' src-tauri/Cargo.toml
[ -d src-tauri/gen/android ] && cat > src-tauri/gen/android/tauri.properties << PROPS
tauri.android.versionCode=${VERSION_CODE}
tauri.android.versionName=${DISPLAY_VERSION}
PROPS

export PROJECT_VERSION="${DISPLAY_VERSION}"
export PROJECT_VERSION_CODE="${VERSION_CODE}"
echo "Done: ${DISPLAY_VERSION} (versionCode ${VERSION_CODE})"
