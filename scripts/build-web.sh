#!/usr/bin/env bash
# natally — R.4 web PWA build (ARCHITECTURE.md §3 web leg, §14 artifact contract).
#
# Contract:
#   * vite build of apps/local into apps/local/dist/web with a relative base,
#     via CLI overrides only — vite.config.ts is NOT edited (its build.outDir
#     stays the native-leg default; this leg overrides on the command line,
#     per the R.4 note).
#   * one stamped artifact per the R1 lineage, packed into the tracked root
#     dist/ (house artifact contract §14):
#         dist/mba.robin.natally-v<MAJOR.MINOR.BUILD>-web.tar.gz
#     Version read from version.txt; identity mba.robin.natally.
#   * The service worker (apps/local/src/sw.ts) is hand-rolled TypeScript that
#     vite compiles once the entry imports it (I.1/I.3 wiring). This script
#     adds no SW tooling and no new dependencies.
#   * vite's own empty-outDir regenerates the build output directory (build
#     output only — no authored file is ever deleted); the artifact tarball is
#     overwritten in place by tar. Both paths are idempotent.
#
# House pattern: `set -euo pipefail`, idempotent, `--dry-run` prints the
# artifact name + stamp plan and builds nothing.
#
# Honest scope note: the FULL build acceptance (a runnable dist/web with the
# U.1 router import resolved) lands at I.1/I.4. Until that lands, the full
# path below is correct-by-construction but the R.4 verify is the --dry-run
# plus the apps/local/src/sw.test.ts suite.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${REPO_ROOT}/apps/local"
OUT_DIR_REL="dist/web"
OUT_DIR="${APP_DIR}/${OUT_DIR_REL}"
DIST_DIR="${REPO_ROOT}/dist"
VERSION_FILE="${REPO_ROOT}/version.txt"

DRY_RUN=0
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "build-web: unknown argument '${arg}' (usage: build-web.sh [--dry-run])" >&2
      exit 2
      ;;
  esac
done

VERSION="$(tr -d ' \t\r\n' < "${VERSION_FILE}")"
if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "build-web: version.txt must contain MAJOR.MINOR.BUILD, got '${VERSION}'" >&2
  exit 1
fi

ARTIFACT_NAME="mba.robin.natally-v${VERSION}-web.tar.gz"
ARTIFACT_PATH="${DIST_DIR}/${ARTIFACT_NAME}"
VITE_ARGS=(build --outDir "${OUT_DIR_REL}" --base ./)

# PWA inputs this artifact is stamped from must exist before any plan or build.
for required in \
  "${APP_DIR}/public/manifest.webmanifest" \
  "${APP_DIR}/public/icons/icon.png" \
  "${APP_DIR}/public/icons/natally-icon-1024-rgba.png" \
  "${APP_DIR}/src/sw.ts"; do
  if [[ ! -f "${required}" ]]; then
    echo "build-web: missing required PWA input: ${required}" >&2
    exit 1
  fi
done

if (( DRY_RUN )); then
  echo "web: ${ARTIFACT_NAME} (dry-run — artifact name printed; no build)"
  echo "web: stamp plan"
  echo "web:   version    ${VERSION}  (from version.txt)"
  echo "web:   identity   mba.robin.natally  (manifest id; theme #120C1C)"
  echo "web:   app        ${APP_DIR}"
  echo "web:   vite       pnpm --dir apps/local exec vite ${VITE_ARGS[*]}"
  echo "web:   outDir     ${OUT_DIR}"
  echo "web:   pack       tar -czf ${ARTIFACT_PATH} -C ${OUT_DIR} ."
  echo "web:   sw         apps/local/src/sw.ts (compiled by vite at entry import, I.1/I.3)"
  exit 0
fi

command -v pnpm >/dev/null 2>&1 || {
  echo "build-web: pnpm not found on PATH" >&2
  exit 1
}

echo "web: building ${APP_DIR} -> ${OUT_DIR_REL} (base ./)"
pnpm --dir "${APP_DIR}" exec vite "${VITE_ARGS[@]}"

mkdir -p "${DIST_DIR}"
tar -czf "${ARTIFACT_PATH}" -C "${OUT_DIR}" .
echo "web: ${ARTIFACT_NAME}"
echo "web: packed ${OUT_DIR} -> ${ARTIFACT_PATH}"
