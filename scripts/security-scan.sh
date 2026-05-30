#!/bin/bash
# Live security scan against production. Usage:
#   ./scripts/security-scan.sh <backend-url> <frontend-url>
# Default: проверяет твой Railway + Vercel.
#
# Что тестит:
#  - HTTP security headers (HSTS, X-Frame-Options, CSP, nosniff)
#  - Admin endpoints без auth → должны 401
#  - CORS отбивает чужой origin
#  - SQL injection в логин — DTO-валидация ловит
#  - Path traversal в /uploads → 404
#  - Rate limit / account lockout срабатывает
#  - Невалидный JWT → 401
#  - Swagger закрыт в проде (если ENABLE_SWAGGER не выставлен)
#  - Server header не палит технологию

set -u
BACKEND="${1:-https://sabtcrmsystem-production.up.railway.app}"
FRONTEND="${2:-https://sabt-crm-system-frontend.vercel.app}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; NC='\033[0m'
pass=0; fail=0; warn=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    printf "  ${GREEN}✓${NC} %s\n" "$name"
    pass=$((pass+1))
  else
    printf "  ${RED}✗${NC} %s — expected %s, got %s\n" "$name" "$expected" "$actual"
    fail=$((fail+1))
  fi
}

warn_test() {
  printf "  ${YELLOW}⚠${NC} %s\n" "$1"
  warn=$((warn+1))
}

http_code() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

echo "═══════════════════════════════════════════"
echo "  Security scan: ${BACKEND}"
echo "═══════════════════════════════════════════"

# ─── Headers ────────────────────────────────────────────────────────
echo ""
echo "[1] Security headers"
headers=$(curl -sI "${BACKEND}/api/health")
echo "$headers" | grep -qi "strict-transport-security" && \
  printf "  ${GREEN}✓${NC} HSTS present\n" || \
  { printf "  ${RED}✗${NC} HSTS missing\n"; fail=$((fail+1)); }
echo "$headers" | grep -qi "x-content-type-options: nosniff" && \
  printf "  ${GREEN}✓${NC} X-Content-Type-Options: nosniff\n" || \
  { printf "  ${RED}✗${NC} nosniff missing\n"; fail=$((fail+1)); }
echo "$headers" | grep -qi "x-frame-options: deny" && \
  printf "  ${GREEN}✓${NC} X-Frame-Options: DENY\n" || \
  { printf "  ${RED}✗${NC} X-Frame-Options missing\n"; fail=$((fail+1)); }
echo "$headers" | grep -qi "x-powered-by" && \
  warn_test "X-Powered-By header leaks framework" || \
  printf "  ${GREEN}✓${NC} No X-Powered-By leak\n"

# ─── Admin endpoints без auth ─────────────────────────────────────
echo ""
echo "[2] Admin endpoints require auth"
check "GET /api/users → 401"             "401" "$(http_code ${BACKEND}/api/users)"
check "GET /api/finance → 401"           "401" "$(http_code ${BACKEND}/api/finance)"
check "GET /api/auth/security-log → 401" "401" "$(http_code ${BACKEND}/api/auth/security-log)"
check "GET /api/teams → 401"             "401" "$(http_code ${BACKEND}/api/teams)"

# ─── CORS ──────────────────────────────────────────────────────────
echo ""
echo "[3] CORS"
cors_headers=$(curl -sI -X OPTIONS "${BACKEND}/api/auth/login" \
  -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: POST")
if echo "$cors_headers" | grep -qi "access-control-allow-origin: https://evil"; then
  printf "  ${RED}✗${NC} Evil origin allowed!\n"
  fail=$((fail+1))
else
  printf "  ${GREEN}✓${NC} Evil origin blocked (no ACAO header)\n"
  pass=$((pass+1))
fi

# ─── SQL injection ─────────────────────────────────────────────────
echo ""
echo "[4] SQL injection in login"
sql_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BACKEND}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"x' OR '1'='1\",\"password\":\"y\"}")
if [ "$sql_code" = "400" ] || [ "$sql_code" = "401" ]; then
  printf "  ${GREEN}✓${NC} SQL injection rejected (HTTP %s)\n" "$sql_code"
  pass=$((pass+1))
elif [ "$sql_code" = "500" ]; then
  printf "  ${RED}✗${NC} HTTP 500 on injection attempt → possible parser leak\n"
  fail=$((fail+1))
else
  printf "  ${YELLOW}⚠${NC} Unexpected HTTP %s\n" "$sql_code"
  warn=$((warn+1))
fi

# ─── Path traversal ────────────────────────────────────────────────
echo ""
echo "[5] Path traversal"
check "/uploads/../../etc/passwd → 404" "404" "$(http_code ${BACKEND}/uploads/../../etc/passwd)"
check "/uploads/files/../../package.json → 404" "404" "$(http_code ${BACKEND}/uploads/files/../../package.json)"

# ─── Invalid JWT ───────────────────────────────────────────────────
echo ""
echo "[6] JWT validation"
check "Bogus Bearer → 401" "401" "$(http_code -H 'Authorization: Bearer not-real' ${BACKEND}/api/auth/me)"

# ─── Swagger ───────────────────────────────────────────────────────
echo ""
echo "[7] Swagger exposure"
swagger_code=$(http_code "${BACKEND}/api/docs")
if [ "$swagger_code" = "404" ]; then
  printf "  ${GREEN}✓${NC} Swagger closed in production (404)\n"
  pass=$((pass+1))
elif [ "$swagger_code" = "200" ]; then
  warn_test "Swagger is PUBLIC — full API surface visible. Set ENABLE_SWAGGER=false (or remove the var) in prod env."
else
  warn_test "Swagger returned unexpected HTTP $swagger_code"
fi

# ─── Frontend CSP ──────────────────────────────────────────────────
echo ""
echo "[8] Frontend CSP (${FRONTEND})"
fe_headers=$(curl -sI "${FRONTEND}/")
echo "$fe_headers" | grep -qi "content-security-policy" && \
  printf "  ${GREEN}✓${NC} CSP present\n" || \
  { printf "  ${RED}✗${NC} CSP missing\n"; fail=$((fail+1)); }
echo "$fe_headers" | grep -qi "strict-transport-security.*preload" && \
  printf "  ${GREEN}✓${NC} HSTS preload\n" || \
  warn_test "HSTS without preload"
if echo "$fe_headers" | grep -qi "script-src.*unsafe-eval"; then
  printf "  ${RED}✗${NC} CSP contains 'unsafe-eval'\n"
  fail=$((fail+1))
else
  printf "  ${GREEN}✓${NC} No 'unsafe-eval' in CSP\n"
  pass=$((pass+1))
fi
if echo "$fe_headers" | grep -qi "script-src.*unsafe-inline"; then
  warn_test "CSP contains 'unsafe-inline' (known compromise for Tailwind/React)"
fi

# ─── Rate limit ────────────────────────────────────────────────────
echo ""
echo "[9] Login rate limit / account lockout (12 attempts)"
codes=""
for i in $(seq 1 12); do
  code=$(http_code -X POST "${BACKEND}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"ratelimittest@nobody.local","password":"wrong1234"}')
  codes="$codes $code"
done
echo "  Codes:$codes"
if echo "$codes" | grep -q "429"; then
  printf "  ${GREEN}✓${NC} Rate limit triggered (429)\n"
  pass=$((pass+1))
else
  printf "  ${RED}✗${NC} 12 wrong logins, NO 429. Lockout not working.\n"
  fail=$((fail+1))
fi

# ─── Summary ───────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
printf "  ${GREEN}Passed: %d${NC}   ${RED}Failed: %d${NC}   ${YELLOW}Warnings: %d${NC}\n" "$pass" "$fail" "$warn"
echo "═══════════════════════════════════════════"

[ "$fail" -eq 0 ]
