#!/usr/bin/env bash
# R.2 / D8 / CC12 / INC-18: Windows build, host-detecting. Linux host -> cargo-xwin cross
# build + NSIS setup (exe + setup.exe); Windows host -> msi + msix via the native toolchain.
# Idempotent per stamp; never overwrites an existing stamped artifact (TC5).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

force=0
dry=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --dry-run) dry=1 ;;
    *) echo "Usage: scripts/build-windows.sh [--dry-run] [--force]" >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in
  Linux) host=linux ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) host=windows ;;
  *) echo "windows: unsupported build host $(uname -s)" >&2; exit 2 ;;
esac

version="$(tr -d '[:space:]' < version.txt)"
setup="dist/mba.robin.natally-v${version}-win-setup.exe"
exe="dist/mba.robin.natally-v${version}-win.exe"

if [ "$dry" -eq 1 ]; then
  if [ "$host" = linux ]; then
    echo "windows: plan (re)stamp; cargo-xwin cross build target x86_64-pc-windows-msvc; NSIS setup bundle"
    echo "windows: artifacts -> ${exe} and ${setup} (msi/msix are produced only on a Windows host, per D8)"
  else
    echo "windows: plan (re)stamp; native tauri build; bundles msi,msix,nsis"
    echo "windows: artifacts -> ${exe}, ${setup}, dist/mba.robin.natally-v${version}-win.msi, -win.msix"
  fi
  exit 0
fi

if { [ "$host" = linux ] && [ -f "$setup" ] && [ -f "$exe" ]; } && [ "$force" -eq 0 ]; then
  echo "windows: v${version} artifacts already present; nothing to do (use --force to rebuild)"
  exit 0
fi

bash scripts/update-version.sh
bash scripts/update-version.sh --check
version="$(tr -d '[:space:]' < version.txt)"
setup="dist/mba.robin.natally-v${version}-win-setup.exe"
exe="dist/mba.robin.natally-v${version}-win.exe"
if [ -e "$setup" ] || [ -e "$exe" ]; then
  echo "windows: refusing to overwrite existing v${version} artifacts (TC5)" >&2
  exit 1
fi

mkdir -p dist
if [ "$host" = linux ]; then
  command -v cargo-xwin >/dev/null || { echo "windows: cargo-xwin is required on a Linux host" >&2; exit 1; }
  command -v makensis >/dev/null || { echo "windows: makensis (NSIS) is required for the setup bundle" >&2; exit 1; }
  # tauri invokes plain `cargo`, which builds the MSVC target without cargo-xwin's
  # cc/link environment (cc-rs then demands lib.exe). Shim cargo so `cargo build`
  # transparently routes through `cargo xwin build` for this invocation only.
  # The shim must call cargo by ABSOLUTE path — a bare `cargo` would resolve back
  # to the shim itself and recurse forever (observed: 63 min of spinning exec).
  shim=".tmp/xwin-shim"
  mkdir -p "$shim"
  real_cargo="$(command -v cargo)"
  cat > "$shim/cargo" <<SHIM
#!/usr/bin/env bash
if [ "\$1" = "build" ]; then exec "$real_cargo" xwin "\$@"; fi
exec "$real_cargo" "\$@"
SHIM
  chmod +x "$shim/cargo"
  PATH="$(pwd)/$shim:$PATH" pnpm --filter @natally/local exec tauri build --target x86_64-pc-windows-msvc --bundles nsis
  bin="apps/local/src-tauri/target/x86_64-pc-windows-msvc/release/natally.exe"
  bundle_setup="$(find apps/local/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis -maxdepth 1 -name '*-setup.exe' -print -quit)"
else
  pnpm --filter @natally/local exec tauri build --bundles msi,msix,nsis
  bin="apps/local/src-tauri/target/release/natally.exe"
  bundle_setup="$(find apps/local/src-tauri/target/release/bundle/nsis -maxdepth 1 -name '*-setup.exe' -print -quit)"
fi
[ -f "$bin" ] || { echo "windows: tauri produced no natally.exe" >&2; exit 1; }
[ -n "$bundle_setup" ] && [ -f "$bundle_setup" ] || { echo "windows: tauri produced no NSIS setup" >&2; exit 1; }
cp "$bin" "$exe"
cp "$bundle_setup" "$setup"
echo "windows: staged ${exe}"
echo "windows: staged ${setup}"
