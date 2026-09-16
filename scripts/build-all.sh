#!/usr/bin/env bash
# =============================================================================
# scripts/build-all.sh — natally release matrix orchestrator (R.5)
#
# Sequences the four per-target builders (ARCHITECTURE.md §14) in canonical
# order and, when every target succeeds, consumes the build with the stamper's
# post-build bump:
#
#   linux    → scripts/build-linux.sh    (AppImage, deb)
#   windows  → scripts/build-windows.sh  (D8 host-detecting: exe+NSIS cross on
#                                          Linux; msi+msix on a Windows host)
#   android  → scripts/build-android.sh  (apk, aab)
#   web      → scripts/build-web.sh      (PWA → dist/web, -web.tar.gz)
#
# then: scripts/update-version.sh --post-build
#       (consume the attestation of a SUCCESSFUL matrix: bump the tree off the
#       shipped stamp so it never rests at a released version)
#
# Each target is invoked by its real path in its default mode — every builder
# is idempotent on its own (existing artifacts at the current stamp are kept /
# skipped; --force stays a per-target concern and is NOT re-exposed here).
#
# -----------------------------------------------------------------------------
# The two different "release.lock" things in this repo (reconciliation, per the
# stamper's actual behavior — read scripts/update-version.sh before changing):
#
#   1. The FREEZE FILE  release.lock  (repo root, a regular FILE):
#      written by a human/orchestrator release flow to pin MAJOR/MINOR/BUILD_NUM.
#      The stamper's stamp mode converges every target to those frozen values,
#      and its --bump/--post-build modes REFUSE while the file exists ("matrix
#      in flight, orchestrator owns the bump"). This script HONORS the freeze:
#      targets build at the frozen stamp (their own pre-build stamps converge to
#      it), and the final --post-build is still attempted per the R.5 spec —
#      a frozen release makes the stamper refuse, which is propagated as a
#      failure WITH the reconciliation explanation printed (the artifacts from a
#      successful matrix remain valid; the bump belongs to whoever owns the
#      freeze and must be done explicitly after it is lifted).
#      DOCUMENTED CHOICE: build-all does not silently skip the post-build bump
#      under a freeze — it runs it, honors the stamper's refusal, and says so.
#
#   2. The SINGLE-FLIGHT LOCK  dist/.release-lock  (a transient DIRECTORY):
#      this script's own atomic mutual-exclusion. Acquired with mkdir (atomic —
#      fails if it exists), holding pid/started files for the refusal message;
#      released by an EXIT trap (INT/TERM mapped to exit so the trap fires).
#      Only the files this very run wrote inside the lock directory are removed
#      at release (rm -f pid started + rmdir) — that removal is the lock's own
#      prescribed lifecycle, not artifact deletion (I-0 untouched).
#      Because the stamper tests [ -f release.lock ] (a FILE check), the
#      single-flight lock directory never trips the stamper's refusal — so the
#      post-build bump runs while THIS script still holds the single-flight
#      lock (the whole release run is one flight; the lock drops last).
#      A stale lock (SIGKILL, power loss — no trap runs) is refused with the
#      recorded pid + a manual-removal instruction; it is never auto-removed.
#
# -----------------------------------------------------------------------------
# Usage: scripts/build-all.sh [--only <t1,t2,...>] [--dry-run]
#   (default)   single-flight lock → build linux → windows → android → web →
#               post-build bump (update-version.sh --post-build) → release lock
#   --only ...  comma-separated subset of {linux,windows,android,web}; the
#               canonical order above is always preserved (it is a filter, not
#               a reordering); unknown or empty target ⇒ usage, exit 2
#   --dry-run   print "lock: acquire (dry-run — not taken)", invoke each
#               selected target's script WITH --dry-run (side-effect-free, so
#               the printed artifact plan is the builders' real plan), print
#               the post-build step without running it, then
#               "lock: release (dry-run)"; nothing is locked, built or stamped
#
# House: set -euo pipefail; idempotent; never deletes project files; no git.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMPER="$ROOT/scripts/update-version.sh"
DIST_DIR="$ROOT/dist"
LOCK_DIR="$DIST_DIR/.release-lock"
FREEZE_FILE="$ROOT/release.lock"

ALL_TARGETS=(linux windows android web)

usage() {
  cat <<'USAGE'
[build-all] usage: scripts/build-all.sh [--only <t1,t2,...>] [--dry-run]
  (default)   single-flight lock, then build linux → windows → android → web,
              then post-build bump via scripts/update-version.sh --post-build
  --only ...  comma-separated subset of {linux,windows,android,web} (canonical
              order preserved; unknown/empty target ⇒ exit 2)
  --dry-run   print the sequence: lock acquire/release (not taken), each
              target's own --dry-run plan, the post-build step — runs nothing
USAGE
}

usage_err() {  # $1 reason — usage to stderr, exit 2
  echo "[build-all] ERROR: $1" >&2
  usage >&2
  exit 2
}

# --- arguments ----------------------------------------------------------------
ONLY=""
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only)
      [ $# -ge 2 ] || usage_err "--only needs a comma-separated target list"
      ONLY="$2"; shift 2
      ;;
    --only=*)
      ONLY="${1#--only=}"; shift
      ;;
    --dry-run)
      DRY_RUN=1; shift
      ;;
    -h|--help)
      usage; exit 0
      ;;
    *)
      usage_err "unknown argument: $1"
      ;;
  esac
done

# --- target selection: filter of the canonical sequence, order preserved ------
SELECTED=()
if [ -z "$ONLY" ]; then
  SELECTED=("${ALL_TARGETS[@]}")
else
  declare -a TOKS=()
  IFS=',' read -r -a TOKS <<< "$ONLY"
  for tok in "${TOKS[@]}"; do
    tok="$(printf '%s' "$tok" | tr -d '[:space:]')"
    [ -n "$tok" ] || usage_err "empty token in --only list: '${ONLY}'"
    _valid=0
    for t in "${ALL_TARGETS[@]}"; do [ "$tok" = "$t" ] && _valid=1; done
    [ "$_valid" -eq 1 ] || usage_err "unknown target '${tok}' (valid: linux, windows, android, web)"
  done
  for t in "${ALL_TARGETS[@]}"; do            # canonical order, always
    for tok in "${TOKS[@]}"; do
      [ "$(printf '%s' "$tok" | tr -d '[:space:]')" = "$t" ] && SELECTED+=("$t")
    done
  done
  [ "${#SELECTED[@]}" -gt 0 ] || usage_err "--only matched no targets: '${ONLY}'"
fi

TOTAL="${#SELECTED[@]}"
plan_line() {  # $1 index, $2 target
  printf '[build-all] [%s/%s] target: %s  (scripts/build-%s.sh)\n' "$1" "$TOTAL" "$2" "$2"
}

freeze_note() {  # one honest line about the freeze file, shared by both modes
  if [ -f "$FREEZE_FILE" ]; then
    echo "[build-all] release.lock freeze FILE present: ${FREEZE_FILE}"
    echo "[build-all]   targets will stamp to the frozen values; the stamper will REFUSE the"
    echo "[build-all]   final --post-build bump ('orchestrator owns the bump') — see header."
  else
    echo "[build-all] release.lock freeze FILE: absent — post-build bump will run normally"
  fi
}

# --- single-flight lock (real runs only) ---------------------------------------
LOCK_HELD=0

release_lock() {
  [ "$LOCK_HELD" -eq 1 ] || return 0
  LOCK_HELD=0
  # remove only what this run wrote inside its own lock dir, then the dir itself
  rm -f "$LOCK_DIR/pid" "$LOCK_DIR/started" 2>/dev/null || true
  rmdir "$LOCK_DIR" 2>/dev/null || true
  echo "[build-all] lock: release ($LOCK_DIR)"
}

acquire_lock() {
  [ -d "$DIST_DIR" ] || mkdir -p "$DIST_DIR"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    local lpid="" lstart=""
    lpid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    lstart="$(cat "$LOCK_DIR/started" 2>/dev/null || true)"
    echo "[build-all] REFUSED: a release run is already in flight — single-flight lock held at ${LOCK_DIR}" >&2
    echo "[build-all]   holder pid: ${lpid:-<unknown>}  started: ${lstart:-<unknown>}" >&2
    if [ -n "$lpid" ] && ! kill -0 "$lpid" 2>/dev/null; then
      echo "[build-all]   that pid is not running — this looks like a STALE lock (e.g. SIGKILL" >&2
      echo "[build-all]   bypassed the release trap). If you are certain no release is in flight," >&2
      echo "[build-all]   remove it manually: rmdir ${LOCK_DIR}   (never auto-removed by this script)" >&2
    fi
    exit 1
  fi
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
  date -Iseconds > "$LOCK_DIR/started"
  LOCK_HELD=1
  echo "[build-all] lock: acquire ($LOCK_DIR — pid $$)"
  trap release_lock EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

# =============================================================================
# --- dry-run: sequence the plan, take nothing, build nothing ------------------
# =============================================================================
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[build-all] DRY-RUN — release plan for: ${SELECTED[*]}"
  echo "[build-all] lock: acquire (dry-run — not taken)"
  if [ -d "$LOCK_DIR" ]; then
    echo "[build-all] note: a single-flight lock already exists at ${LOCK_DIR} (pid $(cat "$LOCK_DIR/pid" 2>/dev/null || echo '?')) — dry-run proceeds without taking it"
  fi
  freeze_note
  echo "[build-all] sequence (canonical order, ${TOTAL} target(s)):"
  _i=0
  for t in "${SELECTED[@]}"; do
    _i=$((_i + 1))
    plan_line "$_i" "$t"
    script="$ROOT/scripts/build-${t}.sh"
    if [ ! -f "$script" ]; then
      echo "[build-all] FAIL: builder missing: $script" >&2
      exit 1
    fi
    # side-effect-free: the target's own --dry-run prints its real artifact plan
    if ! bash "$script" --dry-run; then
      echo "[build-all] FAIL: target '${t}' dry-run plan failed (exit $?) — sequence aborted" >&2
      exit 1
    fi
  done
  echo "[build-all] post-build step (dry-run — not run): bash scripts/update-version.sh --post-build"
  echo "[build-all]   consume the attestation of a successful matrix: bump the tree off the"
  echo "[build-all]   shipped stamp (MINOR heartbeat, fresh epoch BUILD). Refuses while a"
  echo "[build-all]   frozen release.lock FILE exists; runs while the single-flight lock is held."
  echo "[build-all] lock: release (dry-run)"
  exit 0
fi

# =============================================================================
# --- real run: lock → sequence → post-build bump → (trap) release -------------
# =============================================================================
acquire_lock

echo "[build-all] release run: targets (in order): ${SELECTED[*]}"
freeze_note

_i=0
_aborted=()
for t in "${SELECTED[@]}"; do
  _i=$((_i + 1))
  plan_line "$_i" "$t"
  script="$ROOT/scripts/build-${t}.sh"
  if [ ! -f "$script" ]; then
    echo "[build-all] FAIL: builder missing: $script" >&2
    exit 1
  fi
  set +e
  bash "$script"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "[build-all] FAIL: target '${t}' (scripts/build-${t}.sh) exited ${rc} — release aborted" >&2
    _rest=()
    for r in "${SELECTED[@]:$_i}"; do _rest+=("$r"); done
    if [ "${#_rest[@]}" -gt 0 ]; then
      echo "[build-all]   targets not run: ${_rest[*]}" >&2
    fi
    exit "$rc"
  fi
  echo "[build-all] ok: target '${t}'"
done

echo "[build-all] all ${TOTAL} target(s) succeeded — post-build bump:"
if [ ! -f "$STAMPER" ]; then
  echo "[build-all] FAIL: stamper missing: $STAMPER — cannot run the post-build bump" >&2
  exit 1
fi
set +e
bash "$STAMPER" --post-build
rc=$?
set -e
if [ "$rc" -ne 0 ]; then
  echo "[build-all] FAIL: post-build bump exited ${rc} (scripts/update-version.sh --post-build)" >&2
  if [ -f "$FREEZE_FILE" ]; then
    echo "[build-all]   reconciliation: a frozen release.lock FILE exists — the stamper refuses" >&2
    echo "[build-all]   the bump by contract ('orchestrator owns the bump'). The matrix artifacts" >&2
    echo "[build-all]   above are valid and remain in dist/; the post-set bump belongs to the" >&2
    echo "[build-all]   freeze owner and must be run explicitly once the freeze is lifted." >&2
  fi
  exit "$rc"
fi

echo "[build-all] done: matrix (${SELECTED[*]}) built and post-build bump applied — lock releases on exit"
