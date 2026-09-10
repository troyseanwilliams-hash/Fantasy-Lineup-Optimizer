#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Keep dependencies and the production bundle synchronized after task merges.
# These commands are intentionally non-interactive because the merge hook has
# stdin closed.
npm install --no-audit --no-fund --prefer-offline
npx playwright install chromium
npm run build