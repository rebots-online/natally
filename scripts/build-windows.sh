#!/usr/bin/env bash
# =============================================================================
# scripts/build-windows.sh — natally Windows packaging (D8: host-detecting)
#
# D8 — "Windows packaging by build host": the script detects the host OS and
# picks the one honest Windows packaging path for that host:
#
#   Linux host   → cargo-xwin cross build to x86_64-pc-windows-msvc:
#                    mba.robin.natally-v<version>-win.exe    (raw exe)
#                    mba.robin.natally-v<version>-setup.exe  (NSIS installer,
#                                             tauri bundle args: --bundles nsis)
#                  This is the only Windows path that is real on this dev box.
#   Windows host → Tauri native bundles (Git-Bash/MSYS session on Windows 11):
#                    mba.robin.natally-v<version>-win.msi    (tauri --bundles msi)
#                    mba.robin.natally-v<version>-win.msix   (Store-compatible —
#                  Tauri v2 has no native msix bundler, so the built exe is
#                  packed via the Windows SDK `makeappx` with an AppxManifest;
#                  unsigned — sign with signtool / Partner Center for Store).
#
# Host detection (caveats documented per D8):
#   uname -s = MINGW*/MSYS*/CYGWIN* → Windows host (Git-Bash/MSYS session).
#   uname -s = Linux + WSL kernel   → WSL caveat: routed to the LINUX cross
#       path, because native msi/msix needs real Windows host tooling (WiX,
#       Windows SDK) that WSL cannot drive. Run the Windows leg in a Git-Bash
#       or PowerShell session on the Windows 11 host.
#   anything else                   → no D8 build path (plan/refuse only).
#
# Contract (house build-script pattern, mirrors scripts/update-version.sh):
#   (default)      stamp pre-build via `scripts/update-version.sh` (default
#                  stamp mode: converge every target to version.txt — never
#                  bumps implicitly), then build for the detected host.
#                  Idempotent: the full artifact set already in dist/ for this
#                  stamp is a no-op; existing individual artifacts are kept
#                  unless --force.
#   --dry-run      print the per-host plan (detected host, artifact set,
#                  version stamp plan); exit 0. No stamping, no system-
#                  dependency checks, no cargo/tauri invocation.
#   --force        rebuild and overwrite existing dist/ artifacts.
#
# dist/ is tracked (CC13); this script only ever adds/overwrites — it never
# deletes. Version source: version.txt (same stamp source as the versioner).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

PACKAGE_ID="mba.robin.natally"          # = tauri identifier / PACKAGE_NAME (update-version.sh)
APP_DIR="apps/local"
TAURI_DIR="$APP_DIR/src-tauri"
VERSIONER="scripts/update-version.sh"

usage() {
  cat <<'USAGE'
[build-windows] usage: scripts/build-windows.sh [--dry-run|--force]
  (default)   stamp pre-build (update-version.sh default mode), then build the
              D8 Windows path for the detected host into dist/
  --dry-run   print the per-host plan (host detected, artifact set, version
              stamp plan) and exit 0 — nothing is invoked or checked
  --force     rebuild and overwrite existing dist/ artifacts
USAGE
}

die() {
  echo "[build-windows] ERROR: $*" >&2
  exit 1
}

# --- arguments ---------------------------------------------------------------
DRY_RUN=0
FORCE=0
_arg="${1:-}"
if [ "$_arg" = "--" ]; then _arg="${2:-}"; fi   # pnpm forwards a literal `--` marker
case "$_arg" in
  ""|--)          ;;
  --dry-run)      DRY_RUN=1 ;;
  --force)        FORCE=1 ;;
  -h|--help)      usage; exit 0 ;;
  *)              usage >&2; echo "[build-windows] unknown argument: ${_arg}" >&2; exit 2 ;;
esac

# --- version source: version.txt (same source as update-version.sh) ----------
STAMP_VERSION="$(tr -d '[:space:]' < version.txt 2>/dev/null || true)"
if [ -z "$STAMP_VERSION" ]; then
  echo "[build-windows] version.txt absent or empty — stamp plan falls back to 1.0.0 (update-version.sh law)"
  STAMP_VERSION="1.0.0"
fi

# --- host detection (D8) ------------------------------------------------------
HOST_UNAME="$(uname -s)"
HOST_KIND=""
HOST_DESC=""
WSL_NOTE=""
case "$HOST_UNAME" in
  MINGW*|MSYS*|CYGWIN*)
    HOST_KIND="windows-native"
    HOST_DESC="Windows host (Git-Bash/MSYS session)"
    ;;
  Linux*)
    if grep -qiE 'microsoft|WSL' /proc/version 2>/dev/null; then
      HOST_KIND="linux-cross"
      HOST_DESC="WSL (Linux kernel under Windows)"
      WSL_NOTE="[build-windows] D8 caveat: WSL reports uname -s = Linux and is routed to the LINUX cross path (cargo-xwin). Native -win.msi/-win.msix needs real Windows host tooling (WiX, Windows SDK) that WSL cannot drive — run the Windows leg in a Git-Bash/PowerShell session on the Windows 11 host."
    else
      HOST_KIND="linux-cross"
      HOST_DESC="Linux host"
    fi
    ;;
  Darwin*)
    HOST_KIND="unsupported"
    HOST_DESC="macOS host — D8 defines no macOS Windows-packaging path"
    ;;
  *)
    HOST_KIND="unsupported"
    HOST_DESC="unrecognized host (uname -s = ${HOST_UNAME})"
    ;;
esac

# --- the plan -----------------------------------------------------------------
print_plan() {
  echo "[build-windows] host detected: uname -s = '${HOST_UNAME}' → ${HOST_DESC}"
  if [ -n "$WSL_NOTE" ]; then echo "$WSL_NOTE"; fi
  echo "[build-windows] version stamp plan: run ${VERSIONER} (default stamp mode) pre-build — converge version.json / package.json / ${TAURI_DIR}/tauri.conf.json / ${TAURI_DIR}/Cargo.toml to version.txt = v${STAMP_VERSION} (no implicit bump)"
  case "$HOST_KIND" in
    linux-cross)
      echo "[build-windows] artifact set for THIS host (Linux cross → cargo-xwin, target x86_64-pc-windows-msvc) → dist/:"
      echo "[build-windows]   ${PACKAGE_ID}-v${STAMP_VERSION}-win.exe    (raw exe via cargo-xwin cross build)"
      echo "[build-windows]   ${PACKAGE_ID}-v${STAMP_VERSION}-setup.exe  (NSIS installer — tauri bundle args: --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis)"
      echo "[build-windows] other D8 host path (NOT this host): Windows 11 host (Git-Bash) → ${PACKAGE_ID}-v<version>-win.msi + -win.msix (tauri --bundles msi + Windows SDK makeappx)"
      ;;
    windows-native)
      echo "[build-windows] artifact set for THIS host (Windows native) → dist/:"
      echo "[build-windows]   ${PACKAGE_ID}-v${STAMP_VERSION}-win.msi    (tauri --bundles msi — WiX toolchain fetched by the tauri CLI)"
      echo "[build-windows]   ${PACKAGE_ID}-v${STAMP_VERSION}-win.msix   (Store-compatible — AppxManifest + Windows SDK makeappx pack of the built exe; Tauri v2 has no native msix bundler; unsigned — signtool/Partner Center signs it)"
      echo "[build-windows] other D8 host path (NOT this host): Linux host → ${PACKAGE_ID}-v<version>-win.exe + -setup.exe via cargo-xwin cross (target x86_64-pc-windows-msvc, --bundles nsis)"
      ;;
    *)
      echo "[build-windows] artifact set: NONE — no D8 build path for this host (dry-run/plan only)"
      ;;
  esac
}

# --- helpers ------------------------------------------------------------------
strip0() {  # Appx versions are numeric quads — leading zeros must go (1.1.06883 → 1.1.6883.0)
  local s="${1#"${1%%[!0]*}"}"
  printf '%s' "${s:-0}"
}

place() {  # $1 source file, $2 dist filename — the idempotency/--force law for artifacts
  local src="$1" dst="dist/$2"
  if [ -f "$dst" ]; then
    if [ "$FORCE" -eq 1 ]; then
      cp -f "$src" "$dst"
      echo "[build-windows]   --force overwrite: $dst"
    else
      echo "[build-windows]   kept (exists; use --force to overwrite): $dst"
    fi
  else
    cp "$src" "$dst"
    echo "[build-windows]   → $dst"
  fi
}

# =============================================================================
# --- dry-run: plan only, exit 0, nothing invoked, nothing checked ------------
# =============================================================================
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[build-windows] mode: dry-run — printing the per-host plan only"
  print_plan
  echo "[build-windows] dry-run complete (no update-version.sh run, no system-dependency checks, no cargo/tauri invocation)"
  exit 0
fi

# =============================================================================
# --- real build ---------------------------------------------------------------
# =============================================================================
echo "[build-windows] mode: real build for the detected host"
print_plan

if [ "$HOST_KIND" = "unsupported" ]; then
  die "no D8 build path for this host — Windows packaging is Linux-host cross (cargo-xwin) or Windows-host native; --dry-run is the only supported mode here"
fi

# --- pre-build stamp (default mode: converge to version.txt, never bumps) -----
echo "[build-windows] stamp pre-build: bash ${VERSIONER} (default stamp mode)"
bash "$VERSIONER"
STAMP_VERSION="$(tr -d '[:space:]' < version.txt)"
echo "[build-windows] stamp: v${STAMP_VERSION}"

# --- idempotency gate: what would this host produce? --------------------------
case "$HOST_KIND" in
  linux-cross)
    EXPECTED=("${PACKAGE_ID}-v${STAMP_VERSION}-win.exe" "${PACKAGE_ID}-v${STAMP_VERSION}-setup.exe")
    ;;
  windows-native)
    EXPECTED=("${PACKAGE_ID}-v${STAMP_VERSION}-win.msi" "${PACKAGE_ID}-v${STAMP_VERSION}-win.msix")
    ;;
esac
PRESENT=0
MISSING=0
for f in "${EXPECTED[@]}"; do
  if [ -f "dist/$f" ]; then PRESENT=$((PRESENT + 1)); else MISSING=$((MISSING + 1)); fi
done
if [ "$MISSING" -eq 0 ] && [ "$FORCE" -eq 0 ]; then
  echo "[build-windows] no-op: artifact set already in dist/ for v${STAMP_VERSION} — nothing to do (use --force to rebuild)"
  exit 0
fi
if [ "$PRESENT" -gt 0 ] && [ "$FORCE" -eq 0 ]; then
  echo "[build-windows] note: $PRESENT existing dist/ artifact(s) will be kept (use --force to overwrite)"
fi
mkdir -p dist

# --- shared preflight ---------------------------------------------------------
if [ ! -d "$TAURI_DIR" ]; then
  die "${TAURI_DIR} not found — the Tauri 2 shell (apps/local) is not in the tree yet; Windows packaging cannot run"
fi
if ! command -v pnpm >/dev/null 2>&1; then
  die "pnpm not found — install pnpm (corepack enable pnpm) — required to run the tauri CLI"
fi
if [ ! -d node_modules ]; then
  die "node_modules absent at repo root — run 'pnpm install' first (provides @tauri-apps/cli)"
fi

# =============================================================================
# --- Linux host: cargo-xwin cross flow (D8; the real path on this dev box) ===
# =============================================================================
if [ "$HOST_KIND" = "linux-cross" ]; then
  echo "[build-windows] preflight (Linux cross): cargo-xwin + msvc target + NSIS"
  if ! command -v cargo >/dev/null 2>&1; then
    die "missing: cargo — install Rust via rustup (https://rustup.rs) — required for the cross build"
  fi
  if ! cargo xwin --version >/dev/null 2>&1; then
    die "missing: cargo-xwin — run 'cargo install cargo-xwin' — it cross-compiles the MSVC target on Linux (D8)"
  fi
  if ! rustup target list --installed 2>/dev/null | grep -q '^x86_64-pc-windows-msvc$'; then
    die "missing: Rust target x86_64-pc-windows-msvc — run 'rustup target add x86_64-pc-windows-msvc'"
  fi
  if ! command -v makensis >/dev/null 2>&1; then
    die "missing: makensis (NSIS) — install it, e.g. sudo apt install nsis — the tauri NSIS bundle needs it for -setup.exe"
  fi

  echo "[build-windows] building: tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis"
  ( cd "$APP_DIR" && pnpm exec tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis )

  REL="$PROJECT_ROOT/$TAURI_DIR/target/x86_64-pc-windows-msvc/release"
  if [ ! -d "$REL" ]; then
    die "cross-build output dir absent: $REL — the cargo-xwin build did not produce a release dir"
  fi
  RAW_EXE="$(find "$REL" -maxdepth 1 -name '*.exe' ! -name '*webview*' 2>/dev/null | sort | head -n1 || true)"
  if [ -z "$RAW_EXE" ]; then
    die "no raw .exe produced under $REL — the cargo-xwin cross build failed or produced only webview helpers"
  fi
  NSIS_DIR="$REL/bundle/nsis"
  if [ ! -d "$NSIS_DIR" ]; then
    die "NSIS bundle dir absent: $NSIS_DIR — the tauri nsis bundle step did not run or failed"
  fi
  SETUP_EXE="$(find "$NSIS_DIR" -maxdepth 1 -name '*.exe' 2>/dev/null | sort | head -n1 || true)"
  if [ -z "$SETUP_EXE" ]; then
    die "no installer .exe produced under $NSIS_DIR — the NSIS bundle step failed"
  fi
  echo "[build-windows] staging artifacts → dist/:"
  place "$RAW_EXE"  "${PACKAGE_ID}-v${STAMP_VERSION}-win.exe"
  place "$SETUP_EXE" "${PACKAGE_ID}-v${STAMP_VERSION}-setup.exe"
  echo "[build-windows] done (Linux cross → -win.exe + -setup.exe at v${STAMP_VERSION})"
  exit 0
fi

# =============================================================================
# --- Windows host: tauri native msi, then MSIX via Windows SDK (D8) ==========
# =============================================================================
if [ "$HOST_KIND" = "windows-native" ]; then
  echo "[build-windows] building: tauri build --bundles msi (WiX toolchain is fetched by the tauri CLI)"
  ( cd "$APP_DIR" && pnpm exec tauri build --bundles msi )

  MSI_DIR="$PROJECT_ROOT/$TAURI_DIR/target/release/bundle/msi"
  if [ ! -d "$MSI_DIR" ]; then
    die "msi bundle dir absent: $MSI_DIR — the tauri msi bundle step did not run or failed"
  fi
  MSI="$(find "$MSI_DIR" -maxdepth 1 -name '*.msi' 2>/dev/null | sort | head -n1 || true)"
  if [ -z "$MSI" ]; then
    die "no .msi produced under $MSI_DIR — the WiX bundle step failed"
  fi

  MSIX_DST="dist/${PACKAGE_ID}-v${STAMP_VERSION}-win.msix"
  SKIP_MSIX=0
  if [ -f "$MSIX_DST" ] && [ "$FORCE" -eq 0 ]; then SKIP_MSIX=1; fi

  echo "[build-windows] staging artifacts → dist/:"
  place "$MSI" "${PACKAGE_ID}-v${STAMP_VERSION}-win.msi"

  if [ "$SKIP_MSIX" -eq 1 ]; then
    echo "[build-windows]   kept (exists; use --force to overwrite): $MSIX_DST"
    echo "[build-windows] done (Windows native → -win.msi + -win.msix at v${STAMP_VERSION})"
    exit 0
  fi

  # MSIX (honest D8 path): Tauri v2 emits no msix bundler, so we pack the built
  # exe ourselves with the Windows SDK pack tool + a minimal AppxManifest.
  MAKEAPPX="$(ls "/c/Program Files (x86)/Windows Kits/10/bin/"*/x64/makeappx.exe 2>/dev/null | sort | tail -n1 || true)"
  if [ -z "$MAKEAPPX" ]; then
    die "missing: makeappx.exe (Windows SDK App packaging tools) — install the Windows 11 SDK ('Windows Kits\\10\\bin') — required for -win.msix"
  fi
  ICON_SRC="$PROJECT_ROOT/$TAURI_DIR/icons"
  if [ ! -d "$ICON_SRC" ]; then
    die "missing: $TAURI_DIR/icons — generate the app icons (tauri icon) before MSIX packing"
  fi

  V_MAJOR="${STAMP_VERSION%%.*}"
  V_REST="${STAMP_VERSION#*.}"
  V_MINOR="${V_REST%%.*}"
  V_BUILD="${V_REST#*.}"
  MSIX_VERSION="$(strip0 "$V_MAJOR").$(strip0 "$V_MINOR").$(strip0 "$V_BUILD").0"

  STAGE="$PROJECT_ROOT/.tmp/build-windows-msix-staging"
  mkdir -p "$STAGE/assets"
  cp "$ICON_SRC/32x32.png"   "$STAGE/assets/StoreLogo.png"
  cp "$ICON_SRC/32x32.png"   "$STAGE/assets/Square44x44Logo.png"
  cp "$ICON_SRC/128x128.png" "$STAGE/assets/Square150x150Logo.png"
  # raw exe from the native build
  RAW_WIN="$(find "$PROJECT_ROOT/$TAURI_DIR/target/release" -maxdepth 1 -name '*.exe' ! -name '*webview*' 2>/dev/null | sort | head -n1 || true)"
  if [ -z "$RAW_WIN" ]; then
    die "no raw .exe under $TAURI_DIR/target/release — cannot pack the MSIX"
  fi
  cp "$RAW_WIN" "$STAGE/${PACKAGE_ID}.exe"

  # Minimal AppxManifest for a Win32 (full-trust) Tauri app. Publisher is a
  # placeholder until signing: signtool / Partner Center fixes it to the cert
  # subject. Version is the quad-form of the repo stamp.
  cat > "$STAGE/AppxManifest.xml" <<MANIFEST
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="${PACKAGE_ID}" Version="${MSIX_VERSION}" Publisher="CN=mba.robin.natally" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>natally</DisplayName>
    <PublisherDisplayName>mba.robin</PublisherDisplayName>
    <Logo>assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-US" />
  </Resources>
  <Applications>
    <Application Id="natally" Executable="${PACKAGE_ID}.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="natally" Description="natal astrology + synastry companion" Square150x150Logo="assets\\Square150x150Logo.png" Square44x44Logo="assets\\Square44x44Logo.png" BackgroundColor="transparent" />
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
MANIFEST

  echo "[build-windows] packing MSIX: makeappx pack (unsigned — sign with signtool/Partner Center for Store or side-load)"
  "$MAKEAPPX" pack /o /d "$STAGE" /p "$PROJECT_ROOT/$MSIX_DST"
  echo "[build-windows]   → $MSIX_DST"
  echo "[build-windows] done (Windows native → -win.msi + -win.msix at v${STAMP_VERSION})"
  exit 0
fi
