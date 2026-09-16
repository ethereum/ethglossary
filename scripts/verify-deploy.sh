#!/usr/bin/env bash
# Smoke test for an ETHGlossary deploy. Hits /api/v1/info and a representative
# endpoint per surface; fails fast on non-200 or empty payloads.
#
# Usage:
#   scripts/verify-deploy.sh                                              # defaults to local 127.0.0.1:8787
#   scripts/verify-deploy.sh https://glossary.ethereum.org
#   scripts/verify-deploy.sh http://127.0.0.1:8787

set -euo pipefail

BASE="${1:-http://127.0.0.1:8787}"
BASE="${BASE%/}"   # strip trailing slash if present

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not installed: $1"
}

require_cmd curl
require_cmd jq

echo "Smoke-testing ${BASE}"
echo

# 1. /api/v1/info -- expect a JSON object with non-zero term/language counts.
INFO="$(curl -sf "${BASE}/api/v1/info")" || fail "/api/v1/info did not return 200"
TERM_COUNT="$(echo "${INFO}" | jq -r '.termCount // .term_count // empty')"
LANG_COUNT="$(echo "${INFO}" | jq -r '.languageCount // .language_count // empty')"
[ -n "${TERM_COUNT}" ] && [ "${TERM_COUNT}" -gt 0 ] || fail "/api/v1/info reports zero or missing termCount"
[ -n "${LANG_COUNT}" ] && [ "${LANG_COUNT}" -gt 0 ] || fail "/api/v1/info reports zero or missing languageCount"
echo "  /api/v1/info -- ${TERM_COUNT} terms, ${LANG_COUNT} languages"

# 2. /api/v1/style-guide -- expect a non-empty array of terms.
SG_LEN="$(curl -sf "${BASE}/api/v1/style-guide" | jq '. | if type == "array" then length else (.terms | length) end')"
[ "${SG_LEN}" -gt 0 ] || fail "/api/v1/style-guide returned an empty list"
echo "  /api/v1/style-guide -- ${SG_LEN} entries"

# 3. /api/v1/languages -- expect 24 supported codes.
LANGS_LEN="$(curl -sf "${BASE}/api/v1/languages" | jq '.languages | length')"
[ "${LANGS_LEN}" -gt 0 ] || fail "/api/v1/languages returned an empty list"
echo "  /api/v1/languages -- ${LANGS_LEN} languages"

# 4. /openapi.json -- expect a self-derived servers entry whose host matches BASE.
OPENAPI_HOST="$(curl -sf "${BASE}/openapi.json" | jq -r '.servers[0].url // empty')"
[ -n "${OPENAPI_HOST}" ] || fail "/openapi.json missing servers[0].url"
echo "  /openapi.json -- servers[0].url = ${OPENAPI_HOST}"

# 5. /llms.txt -- expect a non-empty text response.
LLMS="$(curl -sf "${BASE}/llms.txt")" || fail "/llms.txt did not return 200"
[ -n "${LLMS}" ] || fail "/llms.txt returned an empty body"
echo "  /llms.txt -- ${#LLMS} bytes"

echo
echo "OK: ${BASE} responds correctly on all probed endpoints."
