#!/usr/bin/env bash
# natally — full workspace verification: typecheck, then lint, then tests.
# Safe in an empty workspace: `pnpm -r` over zero packages is a no-op, and
# vitest exits 0 on "no test files" via --passWithNoTests.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pnpm -r typecheck && pnpm -r lint && pnpm vitest run --silent --passWithNoTests
