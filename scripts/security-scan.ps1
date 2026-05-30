# Live security scan against production. Windows PowerShell-friendly.
# Usage:
#   .\scripts\security-scan.ps1
#   .\scripts\security-scan.ps1 -Backend "https://my-api.example.com" -Frontend "https://my-app.example.com"

param(
    [string]$Backend = "https://sabtcrmsystem-production.up.railway.app",
    [string]$Frontend = "https://sabt-crm-system-frontend.vercel.app"
)

$ErrorActionPreference = "SilentlyContinue"
$script:pass = 0
$script:fail = 0
$script:warn = 0

function Write-Pass($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green; $script:pass++ }
function Write-Fail($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red;   $script:fail++ }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow; $script:warn++ }

function Get-HttpCode($url, $method = "GET", $headers = @{}, $body = $null) {
    try {
        $resp = Invoke-WebRequest -Uri $url -Method $method -Headers $headers -Body $body `
            -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 15
        return [int]$resp.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return -1
    }
}

function Get-Headers($url) {
    try {
        $r = Invoke-WebRequest -Uri $url -Method HEAD -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 15
        return $r.Headers
    } catch { return @{} }
}

Write-Host "═══════════════════════════════════════════"
Write-Host "  Security scan: $Backend"
Write-Host "═══════════════════════════════════════════`n"

# ─── [1] Headers ──────────────────────────────────────────────────
Write-Host "[1] Security headers"
$h = Get-Headers "$Backend/api/health"
if ($h.'Strict-Transport-Security') { Write-Pass "HSTS present" } else { Write-Fail "HSTS missing" }
if ($h.'X-Content-Type-Options' -match 'nosniff') { Write-Pass "nosniff present" } else { Write-Fail "nosniff missing" }
if ($h.'X-Frame-Options' -match 'DENY') { Write-Pass "X-Frame-Options: DENY" } else { Write-Fail "X-Frame-Options missing or wrong" }
if ($h.'X-Powered-By') { Write-Warn "X-Powered-By leaks framework: $($h.'X-Powered-By')" } else { Write-Pass "No X-Powered-By leak" }

# ─── [2] Admin endpoints require auth ─────────────────────────────
Write-Host "`n[2] Admin endpoints require auth"
foreach ($path in @('/api/users', '/api/finance', '/api/auth/security-log', '/api/teams')) {
    $code = Get-HttpCode "$Backend$path"
    if ($code -eq 401) { Write-Pass "$path → 401" } else { Write-Fail "$path → $code (expected 401)" }
}

# ─── [3] CORS ─────────────────────────────────────────────────────
Write-Host "`n[3] CORS"
$corsHeaders = Get-Headers "$Backend/api/health"
try {
    $r = Invoke-WebRequest -Uri "$Backend/api/auth/login" -Method OPTIONS `
        -Headers @{ "Origin" = "https://evil.example.com"; "Access-Control-Request-Method" = "POST" } `
        -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 15
    $acao = $r.Headers.'Access-Control-Allow-Origin'
    if ($acao -match 'evil') {
        Write-Fail "Evil origin allowed! ACAO: $acao"
    } else {
        Write-Pass "Evil origin blocked (no ACAO for evil.example.com)"
    }
} catch { Write-Pass "Evil origin blocked (request failed)" }

# ─── [4] SQL injection ────────────────────────────────────────────
Write-Host "`n[4] SQL injection in login"
$sqlCode = Get-HttpCode "$Backend/api/auth/login" -method POST `
    -headers @{ "Content-Type" = "application/json" } `
    -body '{"email":"x'' OR ''1''=''1","password":"y"}'
if ($sqlCode -in 400,401) {
    Write-Pass "SQL injection rejected (HTTP $sqlCode)"
} elseif ($sqlCode -eq 500) {
    Write-Fail "HTTP 500 on injection — possible parser leak"
} else {
    Write-Warn "Unexpected HTTP $sqlCode"
}

# ─── [5] Path traversal ───────────────────────────────────────────
Write-Host "`n[5] Path traversal"
foreach ($p in @('/uploads/../../etc/passwd','/uploads/files/../../package.json')) {
    $c = Get-HttpCode "$Backend$p"
    if ($c -eq 404) { Write-Pass "$p → 404" } else { Write-Fail "$p → $c (expected 404)" }
}

# ─── [6] Invalid JWT ──────────────────────────────────────────────
Write-Host "`n[6] JWT validation"
$jwtCode = Get-HttpCode "$Backend/api/auth/me" -headers @{ "Authorization" = "Bearer not-real" }
if ($jwtCode -eq 401) { Write-Pass "Bogus Bearer → 401" } else { Write-Fail "Bogus Bearer → $jwtCode" }

# ─── [7] Swagger exposure ─────────────────────────────────────────
Write-Host "`n[7] Swagger exposure"
$sw = Get-HttpCode "$Backend/api/docs"
if ($sw -eq 404) { Write-Pass "Swagger closed in production (404)" }
elseif ($sw -eq 200) { Write-Warn "Swagger is PUBLIC — full API surface visible. Set ENABLE_SWAGGER=false (or remove the var) in prod env." }
else { Write-Warn "Swagger returned HTTP $sw" }

# ─── [8] Frontend CSP ─────────────────────────────────────────────
Write-Host "`n[8] Frontend CSP ($Frontend)"
$fe = Get-Headers "$Frontend/"
if ($fe.'Content-Security-Policy') { Write-Pass "CSP present" } else { Write-Fail "CSP missing" }
$hsts = $fe.'Strict-Transport-Security'
if ($hsts -match 'preload') { Write-Pass "HSTS preload" } else { Write-Warn "HSTS without preload" }
$csp = "$($fe.'Content-Security-Policy')"
if ($csp -match 'unsafe-eval') { Write-Fail "CSP contains 'unsafe-eval'" } else { Write-Pass "No 'unsafe-eval' in CSP" }
if ($csp -match 'unsafe-inline') { Write-Warn "CSP contains 'unsafe-inline' (known Tailwind/React compromise)" }

# ─── [9] Rate limit ───────────────────────────────────────────────
Write-Host "`n[9] Login rate limit / account lockout (12 attempts)"
$codes = @()
for ($i = 1; $i -le 12; $i++) {
    $c = Get-HttpCode "$Backend/api/auth/login" -method POST `
        -headers @{ "Content-Type" = "application/json" } `
        -body '{"email":"ratelimittest@nobody.local","password":"wrong1234"}'
    $codes += $c
}
Write-Host "  Codes: $($codes -join ' ')"
if ($codes -contains 429) {
    Write-Pass "Rate limit triggered (429)"
} else {
    Write-Fail "12 wrong logins, NO 429. Lockout not working."
}

# ─── Summary ──────────────────────────────────────────────────────
Write-Host "`n═══════════════════════════════════════════"
Write-Host "  Passed: $script:pass   " -NoNewline
Write-Host "Failed: $script:fail   " -NoNewline -ForegroundColor Red
Write-Host "Warnings: $script:warn" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════"

if ($script:fail -gt 0) { exit 1 } else { exit 0 }
