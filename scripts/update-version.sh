#!/usr/bin/env bash
# =============================================================================
# scripts/update-version.sh — natally version stamper
# Instance of ~/Admin-Manual/versioning/update-version.sh (BUILD_CONVENTIONS
# § Versioning). version.txt is the single stamp source; this script only
# propagates it. The MINOR heartbeat never fires implicitly: it advances only
# in the explicit bump modes. BUILD = epoch-minutes % 100000.
#
#   versionName = MAJOR.MINOR.BUILD      (e.g. 1.12.06942)
#   versionCode = MAJOR*100000 + MINOR   (BUILD excluded — Play needs monotonic)
#
# Stamp targets (each guarded — an absent target is skipped with a note,
# never a crash): version.txt, version.json, root package.json,
# src-tauri/tauri.conf.json, src-tauri/Cargo.toml (first `version = "..."`),
# and src-tauri/gen/android/tauri.properties when the android gen dir exists.
# Workspace packages (apps/*, packages/*) hold 0.0.0 by design — never stamped.
#
# Modes:
#   (default)      stamp: converge every existing target to the stamp source.
#                  No-op (writes nothing) when everything is already consistent.
#   --check        read-only consistency check across all existing stamp targets;
#                  exits 0 iff all equal version.txt, else 1 listing mismatches.
#   --bump         advance MINOR (+ fresh epoch BUILD), then stamp everywhere.
#                  Refuses under release.lock (frozen release).
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

usage() {
  cat <<'USAGE'
[update-version] usage: scripts/update-version.sh [--check|--bump|--post-build]
  (default)      stamp: converge every existing target to version.txt — no-op when consistent
  --check        read-only consistency check across all existing stamp targets
  --bump         advance MINOR (+ fresh epoch BUILD), then stamp everywhere
  --post-build   consume the attestation of a successful build: bump again (refuses under release.lock)
USAGE
}

MODE="stamp"
_arg="${1:-}"
if [ "$_arg" = "--" ]; then
  _arg="${2:-}"   # pnpm run forwards a literal `--` end-of-options marker before its args
fi
case "$_arg" in
  ""|--)        MODE="stamp" ;;
  --check)      MODE="check" ;;
  --bump)       MODE="bump" ;;
  --post-build) MODE="post-build" ;;
  -h|--help)    usage; exit 0 ;;
  *)            usage >&2; echo "[update-version] unknown mode: ${_arg}" >&2; exit 2 ;;
esac

# --- stamp source: version.txt ----------------------------------------------
STAMP_VERSION="$(tr -d '[:space:]' < "$PROJECT_ROOT/version.txt" 2>/dev/null || true)"
if [ -z "$STAMP_VERSION" ]; then
  if [ "$MODE" = "check" ]; then
    echo "version check: FAIL (version.txt absent or empty — no stamp source)"
    exit 1
  fi
  echo "[update-version] version.txt absent or empty — initializing to 1.0.0"
  STAMP_VERSION="1.0.0"
fi

STAMP_MAJOR="$(printf '%s' "$STAMP_VERSION" | cut -d. -f1)"
STAMP_MINOR="$(printf '%s' "$STAMP_VERSION" | cut -d. -f2)"
STAMP_BUILD="$(printf '%s' "$STAMP_VERSION" | cut -d. -f3)"

malformed_stamp() {
  if [ "$MODE" = "check" ]; then
    echo "version check: FAIL (version.txt malformed: '${STAMP_VERSION}' — expected MAJOR.MINOR.BUILD)"
  else
    echo "[update-version] version.txt malformed: '${STAMP_VERSION}' — expected MAJOR.MINOR.BUILD" >&2
  fi
}
if [ -z "$STAMP_BUILD" ]; then malformed_stamp; exit 1; fi
for _f in "$STAMP_MAJOR" "$STAMP_MINOR"; do
  case "$_f" in ''|*[!0-9]*) malformed_stamp >&2; exit 1 ;; esac
done
# leading zeros must never meet bash arithmetic (octal trap)
BUILD_DIGITS="$(printf '%s' "$STAMP_BUILD" | sed 's/^0*//')"
BUILD_DIGITS="${BUILD_DIGITS:-0}"
case "$BUILD_DIGITS" in *[!0-9]*) malformed_stamp >&2; exit 1 ;; esac

# --- target readers (empty output = absent or unparseable; never fatal) -----
read_json_version() {  # first "version": "..." — mirrors the stampers' first-match writes
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -n1 || true
}
read_cargo_version() {  # first `version = "..."` — mirrors the stamper's 0,/re/ write
  grep -m1 -E '^version[[:space:]]*=' "$1" 2>/dev/null \
    | sed -E 's/^version[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/' || true
}
read_prop() {  # $1 file, $2 key → value after '='
  grep -m1 "^${2}=" "$1" 2>/dev/null | cut -d= -f2- || true
}

# --- --check: read-only ------------------------------------------------------
if [ "$MODE" = "check" ]; then
  FAILED=0
  EXPECTED_CODE=$(( STAMP_MAJOR * 100000 + STAMP_MINOR ))
  echo "version check: source version.txt = ${STAMP_VERSION} (versionCode ${EXPECTED_CODE})"

  check_line() {  # $1 label, $2 found ('' = unreadable), $3 expected
    if [ "$2" = "$3" ]; then
      echo "version check: ok   $1 = $3"
    else
      echo "version check: FAIL $1: found '${2:-<none>}' expected '$3'"
      FAILED=1
    fi
  }

  # Core targets anchor the Accept line — they must exist.
  for _core in version.json package.json; do
    if [ -f "$PROJECT_ROOT/$_core" ]; then
      check_line "$_core" "$(read_json_version "$PROJECT_ROOT/$_core")" "$STAMP_VERSION"
    else
      echo "version check: FAIL $_core: absent (core stamp target)"
      FAILED=1
    fi
  done

  if [ -f "$PROJECT_ROOT/src-tauri/tauri.conf.json" ]; then
    check_line "src-tauri/tauri.conf.json" "$(read_json_version "$PROJECT_ROOT/src-tauri/tauri.conf.json")" "$STAMP_VERSION"
  else
    echo "version check: skip src-tauri/tauri.conf.json (absent)"
  fi

  if [ -f "$PROJECT_ROOT/src-tauri/Cargo.toml" ]; then
    check_line "src-tauri/Cargo.toml" "$(read_cargo_version "$PROJECT_ROOT/src-tauri/Cargo.toml")" "$STAMP_VERSION"
  else
    echo "version check: skip src-tauri/Cargo.toml (absent)"
  fi

  PROPS_FILE="$PROJECT_ROOT/src-tauri/gen/android/tauri.properties"
  if [ -f "$PROPS_FILE" ]; then
    _name="$(read_prop "$PROPS_FILE" tauri.android.versionName)"
    _code="$(read_prop "$PROPS_FILE" tauri.android.versionCode)"
    if [ "$_name" = "$STAMP_VERSION" ] && [ "$_code" = "$EXPECTED_CODE" ]; then
      echo "version check: ok   src-tauri/gen/android/tauri.properties (versionName ${STAMP_VERSION}, versionCode ${EXPECTED_CODE})"
    else
      echo "version check: FAIL src-tauri/gen/android/tauri.properties: found (versionName '${_name:-<none>}', versionCode '${_code:-<none>}') expected ('${STAMP_VERSION}', '${EXPECTED_CODE}')"
      FAILED=1
    fi
  else
    echo "version check: skip src-tauri/gen/android/tauri.properties (absent)"
  fi

  if [ "$FAILED" -eq 0 ]; then
    echo "version check: consistent (version.txt = version.json = package.json)"
    exit 0
  fi
  echo "version check: INCONSISTENT (see FAIL lines above)"
  exit 1
fi

# --- bump modes (explicit only — the heartbeat never fires implicitly) -------
if [ "$MODE" = "bump" ] || [ "$MODE" = "post-build" ]; then
  if [ -f "$LOCK_FILE" ]; then
    if [ "$MODE" = "post-build" ]; then
      echo "[update-version] --post-build refused: release.lock present — matrix in flight, orchestrator owns the bump" >&2
    else
      echo "[update-version] --bump refused: release.lock present — release frozen, orchestrator owns the bump" >&2
    fi
    exit 1
  fi
  if [ "$MODE" = "post-build" ]; then
    echo "[update-version] consuming the attestation of ${STAMP_VERSION} (built) — incrementing the tree"
  fi
  MAJOR="$STAMP_MAJOR"
  MINOR=$(( STAMP_MINOR + 1 ))      # THE heartbeat — never remove; explicit modes only
  BUILD_NUM=$(( $(date +%s) / 60 % 100000 ))
  BUILD_PADDED="$(printf '%05d' "$BUILD_NUM")"
  DISPLAY_VERSION="${MAJOR}.${MINOR}.${BUILD_PADDED}"
else
  # --- stamp: converge to the stamp source (or frozen release.lock values) ---
  if [ -f "$LOCK_FILE" ]; then
    echo "[update-version] Using frozen release.lock values"
    # shellcheck source=/dev/null
    source "$LOCK_FILE" # sets MAJOR, MINOR, BUILD_NUM
    MAJOR="${MAJOR:-}" MINOR="${MINOR:-}" BUILD_NUM="${BUILD_NUM:-}"
    if [ -z "$MAJOR" ] || [ -z "$MINOR" ] || [ -z "$BUILD_NUM" ] \
       || [ "$(printf '%s%s%s' "$MAJOR" "$MINOR" "$BUILD_NUM" | tr -d '0-9')" != "" ]; then
      echo "[update-version] release.lock incomplete (needs MAJOR, MINOR, BUILD_NUM) — falling back to version.txt" >&2
      MAJOR="$STAMP_MAJOR"; MINOR="$STAMP_MINOR"; BUILD_NUM="$STAMP_BUILD"
    fi
    _lock_digits="$(printf '%s' "$BUILD_NUM" | sed 's/^0*//')"
    _lock_digits="${_lock_digits:-0}"
    BUILD_PADDED="$(printf '%05d' "$_lock_digits")"
    DISPLAY_VERSION="${MAJOR}.${MINOR}.${BUILD_PADDED}"
  else
    MAJOR="$STAMP_MAJOR"
    MINOR="$STAMP_MINOR"
    BUILD_PADDED="$STAMP_BUILD"      # keep the source string verbatim — consistency is byte-exact
    DISPLAY_VERSION="$STAMP_VERSION"
  fi
fi

VERSION_CODE=$(( MAJOR * 100000 + MINOR ))

# Shipped-collision note: never silently reuse a stamp that already has artifacts in dist/
# (only meaningful when a NEW stamp is being minted)
if [ "$MODE" = "bump" ] || [ "$MODE" = "post-build" ]; then
  if ls "$PROJECT_ROOT"/dist/*"-v${DISPLAY_VERSION}-"* >/dev/null 2>&1; then
    echo "[update-version] NOTE: dist/ already holds artifacts stamped v${DISPLAY_VERSION} — shipped-stamp collision" >&2
  fi
fi

echo "[update-version] stamp: ${DISPLAY_VERSION}  (versionCode: ${VERSION_CODE})"

# --- guarded writes: a target already at the stamp is never rewritten (no-op law)
CHANGES=0

# version.txt
VT_CUR="$(tr -d '[:space:]' < version.txt 2>/dev/null || true)"
if [ "$VT_CUR" = "$DISPLAY_VERSION" ]; then
  echo "[update-version]   version.txt: already ${DISPLAY_VERSION} — unchanged"
else
  echo "${DISPLAY_VERSION}" > version.txt
  echo "[update-version]   version.txt: → ${DISPLAY_VERSION}"
  CHANGES=$(( CHANGES + 1 ))
fi

# version.json
VJ_VERSION="$(read_json_version "$PROJECT_ROOT/version.json")"
if [ "$VJ_VERSION" = "$DISPLAY_VERSION" ]; then
  echo "[update-version]   version.json: already ${DISPLAY_VERSION} — unchanged"
else
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
  echo "[update-version]   version.json: → ${DISPLAY_VERSION}"
  CHANGES=$(( CHANGES + 1 ))
fi

# root package.json (workspace packages keep 0.0.0 — this is the root only)
if [ -f package.json ]; then
  PJ_VERSION="$(read_json_version "$PROJECT_ROOT/package.json")"
  if ! command -v jq >/dev/null 2>&1; then
    echo "[update-version]   package.json: SKIPPED (jq not installed) — version stays ${PJ_VERSION:-<unknown>}" >&2
  elif [ "$PJ_VERSION" = "$DISPLAY_VERSION" ]; then
    echo "[update-version]   package.json: already ${DISPLAY_VERSION} — unchanged"
  else
    jq --arg v "${DISPLAY_VERSION}" '.version = $v' package.json > package.json.tmp
    mv package.json.tmp package.json
    echo "[update-version]   package.json: → ${DISPLAY_VERSION}"
    CHANGES=$(( CHANGES + 1 ))
  fi
else
  echo "[update-version]   package.json: skip (absent)" >&2
fi

# src-tauri/tauri.conf.json
TC_FILE="src-tauri/tauri.conf.json"
if [ -f "$TC_FILE" ]; then
  TC_VERSION="$(read_json_version "$PROJECT_ROOT/$TC_FILE")"
  if [ "$TC_VERSION" = "$DISPLAY_VERSION" ]; then
    echo "[update-version]   ${TC_FILE}: already ${DISPLAY_VERSION} — unchanged"
  else
    sed -i 's/"version": "[^"]*"/"version": "'"${DISPLAY_VERSION}"'"/' "$TC_FILE"
    echo "[update-version]   ${TC_FILE}: → ${DISPLAY_VERSION}"
    CHANGES=$(( CHANGES + 1 ))
  fi
else
  echo "[update-version]   ${TC_FILE}: skip (absent)"
fi

# src-tauri/Cargo.toml (first top-level `version = "..."` only)
CT_FILE="src-tauri/Cargo.toml"
if [ -f "$CT_FILE" ]; then
  CT_VERSION="$(read_cargo_version "$PROJECT_ROOT/$CT_FILE")"
  if [ "$CT_VERSION" = "$DISPLAY_VERSION" ]; then
    echo "[update-version]   ${CT_FILE}: already ${DISPLAY_VERSION} — unchanged"
  else
    sed -i '0,/^version *= *"[^"]*"/s//version = "'"${DISPLAY_VERSION}"'"/' "$CT_FILE"
    echo "[update-version]   ${CT_FILE}: → ${DISPLAY_VERSION}"
    CHANGES=$(( CHANGES + 1 ))
  fi
else
  echo "[update-version]   ${CT_FILE}: skip (absent)"
fi

# src-tauri/gen/android/tauri.properties (only when the android gen dir exists)
PROPS_FILE="src-tauri/gen/android/tauri.properties"
if [ -d src-tauri/gen/android ]; then
  _have_name="$(read_prop "$PROJECT_ROOT/$PROPS_FILE" tauri.android.versionName)"
  _have_code="$(read_prop "$PROPS_FILE" tauri.android.versionCode)"
  if [ "$_have_name" = "$DISPLAY_VERSION" ] && [ "$_have_code" = "$VERSION_CODE" ]; then
    echo "[update-version]   ${PROPS_FILE}: already at stamp — unchanged"
  else
    cat > "$PROPS_FILE" << PROPS
tauri.android.versionCode=${VERSION_CODE}
tauri.android.versionName=${DISPLAY_VERSION}
PROPS
    echo "[update-version]   ${PROPS_FILE}: → versionName ${DISPLAY_VERSION}, versionCode ${VERSION_CODE}"
    CHANGES=$(( CHANGES + 1 ))
  fi
else
  echo "[update-version]   ${PROPS_FILE}: skip (src-tauri/gen/android absent)"
fi

export PROJECT_VERSION="${DISPLAY_VERSION}"
export PROJECT_VERSION_CODE="${VERSION_CODE}"

if [ "$CHANGES" -eq 0 ]; then
  echo "[update-version] no-op: tree already consistent at ${DISPLAY_VERSION} (versionCode ${VERSION_CODE}) — nothing written"
else
  echo "Done: ${DISPLAY_VERSION} (versionCode ${VERSION_CODE})"
fi
