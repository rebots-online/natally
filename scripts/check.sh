#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pnpm -r typecheck && pnpm -r lint && pnpm vitest run --silent
