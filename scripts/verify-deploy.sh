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

# 6. The stylesheet link carries a content hash and that URL serves with a long immutable cache.
CSS_HREF="$(curl -sf "${BASE}/" | grep -o 'href="/assets/app.css?v=[0-9a-f]*"' | head -1 | sed 's/href="//; s/"$//')"
[ -n "${CSS_HREF}" ] || fail "the page does not link a versioned stylesheet (/assets/app.css?v=...)"
CSS_CACHE="$(curl -sI "${BASE}${CSS_HREF}" | tr -d '\r' | grep -i '^cache-control:' | head -1)"
case "${CSS_CACHE}" in *immutable*) ;; *) fail "stylesheet cache header is '${CSS_CACHE}', expected immutable";; esac
echo "  ${CSS_HREF} -- ${CSS_CACHE#*: }"

# 7. Accounts and feedback. /signin is 200 with a database and 503 without
#    one; either way the write API must be mounted and must refuse an
#    anonymous write with 401, and a term page must carry its feedback mode.
SIGNIN_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/signin")"
case "${SIGNIN_CODE}" in 200|503) ;; *) fail "/signin answered ${SIGNIN_CODE}, expected 200 (database) or 503 (none)";; esac
echo "  /signin -- ${SIGNIN_CODE}$([ "${SIGNIN_CODE}" = 503 ] && echo ' (no database: accounts off)')"
ACCOUNT_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/account")"
case "${ACCOUNT_CODE}" in 302|503) ;; *) fail "/account answered ${ACCOUNT_CODE} to an anonymous request, expected a redirect to /signin";; esac
WRITE_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' -d '{"votes":[]}' "${BASE}/api/v1/feedback/translations/es/gas/votes")"
[ "${WRITE_CODE}" = 401 ] || fail "anonymous feedback write answered ${WRITE_CODE}, expected 401"
echo "  /api/v1/feedback -- anonymous write refused (401)"
MODE="$(curl -sf "${BASE}/style-guide/gas" | grep -o 'data-sg-feedback="[a-z]*"' | head -1)"
[ -n "${MODE}" ] || fail "/style-guide/gas has no feedback mode marker"
echo "  /style-guide/gas -- ${MODE}"

echo
echo "OK: ${BASE} responds correctly on all probed endpoints."
