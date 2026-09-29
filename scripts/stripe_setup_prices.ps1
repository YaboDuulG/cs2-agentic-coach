# Creates the DemoSage products and prices in Stripe, idempotently, and prints
# the three env lines the app reads. Run once per mode (test, then live).
#
#   1. winget install Stripe.StripeCli      (already done on this machine)
#   2. stripe login                          (opens the browser; pairs the CLI)
#   3. .\scripts\stripe_setup_prices.ps1     (add -Live for live mode)
#
# Lookup keys make it safe to re-run: an existing price with the same lookup
# key is reused, never duplicated. Nothing is deleted here; retire the old
# $20 / month Team price by archiving it in the dashboard.

param([switch]$Live)

$ErrorActionPreference = "Stop"

# Auth: either `stripe login` (browser pairing) or a key in the environment.
# STRIPE_API_KEY is what the CLI reads natively; STRIPE_SECRET_KEY is what the
# app's env files use, so accept both. The key is never printed.
if (-not $env:STRIPE_API_KEY -and $env:STRIPE_SECRET_KEY) { $env:STRIPE_API_KEY = $env:STRIPE_SECRET_KEY }
if ($env:STRIPE_API_KEY) {
  $isLiveKey = $env:STRIPE_API_KEY.StartsWith("sk_live_") -or $env:STRIPE_API_KEY.StartsWith("rk_live_")
  if ($Live -and -not $isLiveKey) { throw "-Live was requested but the key in the environment is a test-mode key." }
  if (-not $Live -and $isLiveKey) { throw "The key in the environment is LIVE; pass -Live to confirm you mean it." }
}

function Invoke-Stripe {
  param([string[]]$CliArgs)
  # With an API key in the environment the CLI's mode follows the key; --live
  # is only meaningful for a paired login.
  if ($Live -and -not $env:STRIPE_API_KEY) { $CliArgs += "--live" }
  # No 2>&1: Windows PowerShell 5.1 wraps native stderr lines as errors and
  # breaks $LASTEXITCODE handling. The CLI writes JSON to stdout.
  $out = & stripe @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "stripe $($CliArgs -join ' ') failed (exit $LASTEXITCODE): $out" }
  return ($out | Out-String | ConvertFrom-Json)
}

function Get-OrCreateProduct {
  param([string]$Name, [string]$Description)
  $list = Invoke-Stripe @("products", "list", "--limit", "100")
  $existing = @($list.data | Where-Object { $_.name -eq $Name -and $_.active })
  if ($existing.Count -gt 0) { return $existing[0].id }
  $created = Invoke-Stripe @("products", "create", "-d", "name=$Name", "-d", "description=$Description")
  return $created.id
}

function Get-OrCreatePrice {
  param([string]$ProductId, [string]$LookupKey, [int]$UnitAmountCents, [string]$Interval)
  $list = Invoke-Stripe @("prices", "list", "-d", "lookup_keys[]=$LookupKey", "--limit", "1")
  if (@($list.data).Count -gt 0) { return $list.data[0].id }
  $cliArgs = @("prices", "create",
    "-d", "product=$ProductId",
    "-d", "currency=usd",
    "-d", "unit_amount=$UnitAmountCents",
    "-d", "lookup_key=$LookupKey")
  if ($Interval) { $cliArgs += @("-d", "recurring[interval]=$Interval") }
  return (Invoke-Stripe $cliArgs).id
}

$solo = Get-OrCreateProduct "DemoSage Solo Pro" "Full personal CS2 coaching: every finding with round and tick references, pro benchmarks, drills."
$team = Get-OrCreateProduct "DemoSage Team" "One ESEA season for the whole roster: team analysis, opponent scouting, practice servers, stratbook with Discord."

$soloMonthly = Get-OrCreatePrice $solo "demosage_solo_monthly" 1000 "month"
$soloYearly  = Get-OrCreatePrice $solo "demosage_solo_yearly"  9600 "year"
$teamSeason  = Get-OrCreatePrice $team "demosage_team_season"  30000 $null

""
"Add these to Vercel (Production + Preview) and to frontend/.env.local:"
""
"STRIPE_PRICE_SOLO_MONTHLY=$soloMonthly"
"STRIPE_PRICE_SOLO_YEARLY=$soloYearly"
"STRIPE_PRICE_TEAM_SEASON=$teamSeason"
""
"Mode: $(if ($Live) { 'LIVE' } else { 'test' }). Re-run with -Live for live-mode ids."
