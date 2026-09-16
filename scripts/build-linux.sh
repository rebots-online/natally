#!/usr/bin/env bash
# =============================================================================
# scripts/build-linux.sh — natally Linux desktop builder (R.1)
#
# Builds the @natally/local Tauri 2 app for Linux and places slug-first
# artifacts into dist/ (AGENTS.md artifact naming: mba.robin.natally-v<version>-<qualifier>):
#
#   dist/mba.robin.natally-v<version>-linux.AppImage
#   dist/mba.robin.natally-v<version>-linux.deb
#
# Real-run flow:
#   1. Version stamp pre-build: scripts/update-version.sh in its default
#      (stamp) mode — idempotent converge of every existing stamp target to
#      version.txt; a no-op when the tree is already consistent. Not --check:
#      stamp is safe by construction (writes nothing when consistent).
#   2. Version is read back from version.txt (the single stamp source; under
#      release.lock the stamper rewrites version.txt to the frozen values).
#   3. Frontend step: pnpm --filter @natally/local exec vite build — REQUIRED
#      prerequisite, because apps/local/src-tauri/tauri.conf.json
#      build.frontendDist = "../dist" does not exist until vite emits it.
#      Harmless + idempotent on rebuilds.
#   4. tauri build --bundles appimage deb --config '{"version":"<stamp>"}' via
#      the workspace tauri CLI. Bundle targets and the embedded version are
#      passed as CLI flags/overlay — tauri.conf.json is NOT edited here (it is
#      not owned by this script).
#   5. Bundle outputs are copied (never moved) into dist/ under the slug-first
#      names above.
#
# Idempotency: if both artifacts already exist at the same version the script
# exits 0 without building. If only one is missing, only the missing bundle is
# built. --force rebuilds and overwrites both.
#
# System deps — checked ONLY at real-build time (never under --dry-run); the
# script fails naming the exact missing piece:
#   - rustc/cargo                      (Tauri build backend)
#   - pnpm                             (workspace frontend + CLI resolution)
#   - pkg-config + webkit2gtk-4.1 dev  (fallback webkit2gtk-4.0) — the WebKit
#                                      system library Tauri links on Linux
#   - dpkg-deb                         (deb bundle)
#   - linuxdeploy                      (AppImage bundler — tauri normally
#                                      auto-downloads it into ~/.cache/tauri
#                                      on first use; required in PATH or cache)
#
# LFS note: dist/ is tracked in git and binaries go through git-LFS on forgejo.
# The `git lfs track` lines for *.AppImage / *.deb belong to .gitattributes
# (owned elsewhere) — this script only PLACES files in dist/ and prints the
# LFS-push reminder below. This script never runs git itself.
#
# Usage: scripts/build-linux.sh [--dry-run] [--force]
#   --dry-run  print the artifact names + version stamp plan, exit 0 — no
#              tauri/vite/update-version invocation, no system-dep checks
#   --force    rebuild even when artifacts exist at the same version
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/local"
SRC_TAURI="$APP_DIR/src-tauri"
BUNDLE_ROOT="$SRC_TAURI/target/release/bundle"
DIST_DIR="$ROOT/dist"
VERSION_FILE="$ROOT/version.txt"
LOCK_FILE="$ROOT/release.lock"
STAMPER="$ROOT/scripts/update-version.sh"

SLUG="mba.robin.natally"
QUALIFIER="linux"

usage() {
  cat <<'USAGE'
[build-linux] usage: scripts/build-linux.sh [--dry-run] [--force]
  (default)  stamp version, vite-build the frontend, tauri build (appimage+deb),
             copy into dist/mba.robin.natally-v<version>-linux.{AppImage,deb}
  --dry-run  print artifact names + version stamp plan; build nothing
  --force    rebuild even if artifacts already exist at this version
USAGE
}

DRY_RUN=0
FORCE=0
for _arg in "$@"; do
  case "$_arg" in
    --dry-run) DRY_RUN=1 ;;
    --force)   FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    *)         usage >&2; echo "[build-linux] unknown flag: $_arg" >&2; exit 2 ;;
  esac
done

read_stamp_version() {  # $1 = default when version.txt is absent/empty
  local v
  v="$(tr -d '[:space:]' < "$VERSION_FILE" 2>/dev/null || true)"
  printf '%s' "${v:-$1}"
}

# ---------------------------------------------------------------------------
# Version stamp plan.
# Mirrors scripts/update-version.sh stamp-mode semantics READ-ONLY (the
# stamper itself writes files, so it is never invoked under --dry-run):
#   no release.lock  -> targets converge to version.txt (to == from)
#   release.lock     -> version.txt is rewritten to the frozen lock values
# ---------------------------------------------------------------------------
stamp_to_version() {  # $1 = from-version; prints the post-stamp version
  local from="$1" major minor build digits
  if [ ! -f "$LOCK_FILE" ]; then
    printf '%s' "$from"
    return 0
  fi
  major="$(grep -m1 -E '^MAJOR=' "$LOCK_FILE" | cut -d= -f2- || true)"
  minor="$(grep -m1 -E '^MINOR=' "$LOCK_FILE" | cut -d= -f2- || true)"
  build="$(grep -m1 -E '^BUILD_NUM=' "$LOCK_FILE" | cut -d= -f2- || true)"
  if [ -z "$major" ] || [ -z "$minor" ] || [ -z "$build" ]; then
    printf '%s' "$from"   # incomplete lock: the stamper falls back to version.txt
    return 0
  fi
  digits="$(printf '%s' "$build" | sed 's/^0*//')"
  digits="${digits:-0}"
  case "$digits" in
    *[!0-9]*) printf '%s' "$from"   # malformed lock: the stamper falls back to version.txt
              return 0 ;;
  esac
  printf '%s.%s.%05d' "$major" "$minor" "$digits"
}

FROM_VERSION="$(read_stamp_version "1.0.0")"
TO_VERSION="$(stamp_to_version "$FROM_VERSION")"

ART_APPIMAGE="$DIST_DIR/${SLUG}-v${TO_VERSION}-${QUALIFIER}.AppImage"
ART_DEB="$DIST_DIR/${SLUG}-v${TO_VERSION}-${QUALIFIER}.deb"

# ---------------------------------------------------------------------------
# --dry-run: plan only. No tauri, no vite, no stamper, no system-dep checks.
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[build-linux] DRY-RUN — nothing built, nothing written, no system deps checked."
  echo "[build-linux] version stamp plan:"
  echo "  mode: stamp  (scripts/update-version.sh default mode — idempotent converge of all"
  echo "                existing stamp targets to version.txt; a no-op when already consistent)"
  echo "  from-version: ${FROM_VERSION}  (version.txt now)"
  if [ "$TO_VERSION" = "$FROM_VERSION" ]; then
    echo "  to-version:   ${TO_VERSION}  (no release.lock — targets converge to version.txt)"
  else
    echo "  to-version:   ${TO_VERSION}  (release.lock frozen values — version.txt will be rewritten)"
  fi
  echo "[build-linux] artifacts:"
  if [ -f "$ART_APPIMAGE" ]; then
    echo "  $ART_APPIMAGE  (exists — real run skips unless --force)"
  else
    echo "  $ART_APPIMAGE  (missing — real run builds via tauri --bundles appimage)"
  fi
  if [ -f "$ART_DEB" ]; then
    echo "  $ART_DEB  (exists — real run skips unless --force)"
  else
    echo "  $ART_DEB  (missing — real run builds via tauri --bundles deb)"
  fi
  echo "[build-linux] frontend step (real run): pnpm --filter @natally/local exec vite build"
  echo "  (prerequisite: tauri.conf.json build.frontendDist = ../dist does not exist until vite emits it)"
  echo "[build-linux] real-run system-dep checks (skipped in dry-run): rustc/cargo, pnpm,"
  echo "  pkg-config + webkit2gtk-4.1 dev, dpkg-deb, linuxdeploy (PATH or ~/.cache/tauri)"
  exit 0
fi

# ---------------------------------------------------------------------------
# Real build.
# ---------------------------------------------------------------------------
if [ ! -f "$STAMPER" ]; then
  echo "[build-linux] FAIL: $STAMPER absent — cannot run the version stamp pre-build" >&2
  exit 1
fi

echo "[build-linux] step 1/5: version stamp pre-build (scripts/update-version.sh, stamp mode)"
bash "$STAMPER"

VERSION="$(read_stamp_version "")"
if [ -z "$VERSION" ]; then
  echo "[build-linux] FAIL: version.txt absent/empty after stamp" >&2
  exit 1
fi
case "$VERSION" in
  *.*) : ;;
  *) echo "[build-linux] FAIL: version.txt malformed: '${VERSION}' (expected MAJOR.MINOR.BUILD)" >&2; exit 1 ;;
esac
while IFS=. read -r _vmaj _vmin _vbuild; do
  for _part in "$_vmaj" "$_vmin" "$_vbuild"; do
    case "$_part" in ''|*[!0-9]*) echo "[build-linux] FAIL: version.txt malformed: '${VERSION}'" >&2; exit 1 ;; esac
  done
done <<< "$VERSION"

ART_APPIMAGE="$DIST_DIR/${SLUG}-v${VERSION}-${QUALIFIER}.AppImage"
ART_DEB="$DIST_DIR/${SLUG}-v${VERSION}-${QUALIFIER}.deb"

NEED_APPIMAGE=0
NEED_DEB=0
if [ "$FORCE" -eq 1 ]; then
  NEED_APPIMAGE=1
  NEED_DEB=1
else
  [ -f "$ART_APPIMAGE" ] || NEED_APPIMAGE=1
  [ -f "$ART_DEB" ] || NEED_DEB=1
fi

if [ "$NEED_APPIMAGE" -eq 0 ] && [ "$NEED_DEB" -eq 0 ]; then
  echo "[build-linux] skip: artifacts already exist at v${VERSION} (use --force to rebuild):"
  echo "  $ART_APPIMAGE"
  echo "  $ART_DEB"
  exit 0
fi

BUNDLES=()
[ "$NEED_APPIMAGE" -eq 1 ] && BUNDLES+=(appimage)
[ "$NEED_DEB" -eq 1 ] && BUNDLES+=(deb)

echo "[build-linux] step 2/5: system deps (real-build only)"
fail_missing() {  # $1 piece, $2 remedy
  echo "[build-linux] FAIL: missing system dependency: $1 — $2" >&2
  exit 1
}
command -v cargo >/dev/null 2>&1 || fail_missing "cargo" "install the Rust toolchain (rustup)"
command -v rustc >/dev/null 2>&1 || fail_missing "rustc" "install the Rust toolchain (rustup)"
command -v pnpm >/dev/null 2>&1 || fail_missing "pnpm" "install pnpm (corepack enable)"
command -v pkg-config >/dev/null 2>&1 \
  || fail_missing "pkg-config" "install pkg-config (webkit2gtk dev check needs it)"
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null && ! pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
  fail_missing "webkit2gtk-4.1 (or 4.0) development libraries" \
    "install via pkg-config provider, e.g. distro package libwebkit2gtk-4.1-dev"
fi
if [ "$NEED_DEB" -eq 1 ] && ! command -v dpkg-deb >/dev/null 2>&1; then
  fail_missing "dpkg-deb" "required to assemble the .deb bundle"
fi
if [ "$NEED_APPIMAGE" -eq 1 ] \
  && ! command -v linuxdeploy >/dev/null 2>&1 \
  && ! find "$HOME/.cache/tauri" -maxdepth 1 -name 'linuxdeploy*.AppImage' 2>/dev/null | grep -q .; then
  fail_missing "linuxdeploy (AppImage bundler)" \
    "install it in PATH or let tauri fetch it into ~/.cache/tauri (needs network on first AppImage build)"
fi
echo "[build-linux] system deps ok (bundles: ${BUNDLES[*]})"

echo "[build-linux] step 3/5: frontend build (prerequisite: tauri frontendDist = ../dist)"
pnpm --filter @natally/local exec vite build

echo "[build-linux] step 4/5: tauri build (bundles: ${BUNDLES[*]}; tauri.conf.json untouched — CLI flags only)"
pick_tauri_cli() {
  if pnpm --filter @natally/local exec tauri --version >/dev/null 2>&1; then
    TAURI_CMD=(pnpm --filter @natally/local exec tauri)
  elif [ -x "$ROOT/node_modules/.bin/tauri" ]; then
    TAURI_CMD=("$ROOT/node_modules/.bin/tauri")
  elif command -v cargo-tauri >/dev/null 2>&1; then
    TAURI_CMD=(cargo tauri)
  else
    echo "[build-linux] FAIL: no tauri CLI (workspace @tauri-apps/cli devDep or cargo-tauri)" >&2
    exit 1
  fi
}
pick_tauri_cli
(
  cd "$APP_DIR"
  "${TAURI_CMD[@]}" build --bundles "${BUNDLES[@]}" --config "{\"version\":\"${VERSION}\"}"
)

echo "[build-linux] step 5/5: place slug-first artifacts in dist/"
copy_bundle() {  # $1 bundle subdir, $2 suffix, $3 dest, $4 label
  local dir="$BUNDLE_ROOT/$1" dest="$3" label="$4" picked=""
  picked="$(ls -t "$dir"/*"${VERSION}"*"$2" 2>/dev/null | head -n1 || true)"
  if [ -z "$picked" ]; then
    picked="$(ls -t "$dir"/*"$2" 2>/dev/null | head -n1 || true)"
  fi
  if [ -z "$picked" ] || [ ! -s "$picked" ]; then
    echo "[build-linux] FAIL: tauri emitted no $label under $dir" >&2
    exit 1
  fi
  mkdir -p "$DIST_DIR"
  cp -f "$picked" "$dest"
  echo "[build-linux]   $dest  (from $picked)"
}
if [ "$NEED_APPIMAGE" -eq 1 ]; then
  copy_bundle "appimage" ".AppImage" "$ART_APPIMAGE" "AppImage"
fi
if [ "$NEED_DEB" -eq 1 ]; then
  copy_bundle "deb" ".deb" "$ART_DEB" "deb"
fi

echo "[build-linux] done: v${VERSION} artifacts in dist/:"
ls -l "$DIST_DIR/${SLUG}-v${VERSION}-${QUALIFIER}".* 2>/dev/null || true
echo "[build-linux] LFS reminder: dist/ is tracked; ensure .gitattributes covers *.AppImage and"
echo "[build-linux] *.deb (git-lfs on forgejo) and push the artifacts with LFS. This script runs no git."
