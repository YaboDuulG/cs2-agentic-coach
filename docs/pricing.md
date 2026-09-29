# Competitors and pricing (2026-09-29)

Owner decisions already fixed: Free · Solo Pro · Team, with Team at **$30 / month or
$300 / year** as a hard paywall. This note records what the market charges so the
other two tiers, and any later change to Team, are set against real numbers.

Prices below were checked on 2026-09-29 from search results and vendor blogs; the
vendors' own pricing pages block automated fetches, so re-verify before printing any of
these in marketing copy.

## Who else does this

| Product | What it is | Price | Notes |
|---|---|---|---|
| **Leetify** | Post-match stats, benchmarks, 2D replay, training servers (SCL) | Free tier; Pro about $10 / mo in 2025; $8.99 / mo bundled with Renown | Individual only. Paused FACEIT demo processing in 2025 over API costs. The default "am I improving" tool for solo players. |
| **Scope.gg** | Match analytics, auto highlight and mistake clips, grenade lineups, prematch scouting | Free core; Prematch tier $7.99 / mo; a second paid tier | Individual. Official analytics partner of the StarLadder Budapest Major 2025. |
| **Refrag** | Training servers and drills plus demo tools | Player $7 / mo ($5.40 annual); Competitor $15 / mo ($11.50 annual); **Team $79 / mo ($60 annual)** | The only one with a real team tier. Its price carries server costs. |
| **Noesis** | 2D demo review for higher-level players (positioning, utility) | €9.99 / mo | Individual and teams reviewing together. |
| **RoundIQ** | 2D and 3D demo viewer built for team review | Free, no card | No coaching layer. |
| **Teamwise** | Team management, stratbook canvas, 2D replay, FACEIT sync | Free; paid plans "coming soon" (managed servers, auto ingestion) | The closest thing to our Team tier, currently free. |
| Cybershoke, Pracc, SCL | Practice and retake servers | A few dollars a month | Server access, not analysis. |
| Metafy and human coaches | Live demo review by a person | $20–60 per session | The ceiling on what a "coach" is worth per match. |

Nobody in this list generates a written, evidence-cited coaching report per match, and
nobody ties scouting dossiers, a stratbook, and Discord approval into one team product.
Those two gaps are what the paid tiers sell.

## Decided prices (owner, 2026-09-29)

| Tier | Price | Billing | Where it lives |
|---|---|---|---|
| Free | $0 | — | 2 uploads / month, headline + one finding, 7-day history |
| Solo Pro | **$10 / month** or **$96 / year** (20% off) | Stripe subscription | full personal coaching, benchmarks, 30-day history |
| Team | **$300 per ESEA season**, flat | Stripe one-time payment | everything: team, seats, scouting, servers, stratbook + Discord |

Team follows ESEA's calendar. Published 2026 seasons (dust2.us, "ESEA releases 2026
calendar"; ESEA says dates may change): S56 Jan 13 – Mar 23, S57 Apr 6 – Jun 21,
S58 Jul 13 – Sep 27, **S59 Oct 5 – Dec 20**. From S60 on, `services/billing/seasons.py`
projects four seasons a year (eleven weeks each, thirteen between starts) and flags them
"dates to be confirmed" until the next calendar is published; update `KNOWN_SEASONS`
then. A purchase covers the season on sale (the one in progress, or the next one during
the gap) and access runs until the following season starts, so renewals are seamless
and buying next season early extends rather than truncates.

## What you have to do in Stripe

The code reads three price ids from environment variables and refuses checkout with a
clear error if one is missing. Nothing is hard-coded except the old test-mode Solo Pro
monthly price as a fallback.

**With the CLI (installed via winget on 2026-09-29):**

```powershell
stripe login                          # pairs the CLI with your account in the browser
.\scripts\stripe_setup_prices.ps1     # test mode: creates the products + 3 prices, prints env lines
.\scripts\stripe_setup_prices.ps1 -Live
```

The script is idempotent (prices carry lookup keys `demosage_solo_monthly`,
`demosage_solo_yearly`, `demosage_team_season`) and never deletes anything. It replaces
steps 1 and 2 below; the rest still apply.

1. **Products → DemoSage Solo Pro.** Add two recurring prices: $10.00 / month and
   $96.00 / year. Copy their ids into `STRIPE_PRICE_SOLO_MONTHLY` and
   `STRIPE_PRICE_SOLO_YEARLY`.
2. **Products → DemoSage Team.** Add one **one-time** price of $300.00 (not recurring).
   Copy its id into `STRIPE_PRICE_TEAM_SEASON`. The checkout description names the
   season automatically ("DemoSage Team — ESEA Season 59 (2026-10-05 to 2026-12-20)").
3. **Retire the $20 / month Team price** (archive it in Stripe). Existing subscribers on
   it keep working: the webhook still maps that price id to the Team plan until their
   subscription ends; do not delete the price.
4. **Set the three variables** in Vercel (Production and Preview) and in `.env.local`
   for the dev server. Test mode and live mode have different ids, so set them per
   environment. Use `node scripts/vercel_push_env.mjs production STRIPE_SECRET_KEY
   STRIPE_WEBHOOK_SECRET STRIPE_PRICE_SOLO_MONTHLY STRIPE_PRICE_SOLO_YEARLY
   STRIPE_PRICE_TEAM_SEASON`: piping a value into `vercel env add` from PowerShell leaves
   a carriage return in it, and Stripe then rejects the Authorization header. A new
   deployment is needed before functions see changed values.
   Mint the prices with the same key the app runs with: a key from another Stripe
   environment (a sandbox, or an older account) produces ids the app cannot see.
5. **Webhook events** already subscribed stay the same: `checkout.session.completed`
   (now also handles `mode: payment` for Team), `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`.
6. **Run the migration** `alembic upgrade head` on staging: it adds `promo_codes`,
   `promo_redemptions`, and `subscriptions.season` / `season_until`.
7. **Test in test mode**: buy Team with card 4242 4242 4242 4242, confirm the navbar
   shows Team and `/api/billing/entitlements` returns `source: "season"` with
   `season_until` = next season start; buy Solo Pro yearly and confirm the yearly price
   id maps to `basic` in the webhook.
8. Optional but recommended: **Customer portal** enabled in Stripe so Solo Pro users can
   cancel or switch monthly/yearly themselves; the Team purchase does not need it.

## Market context behind those numbers

**Free.** Two uploads a month with the headline and one finding is in line with every
competitor's free tier. Keep it; it is the referral engine.

**Solo Pro at $10 / month** sits level with Leetify Pro (about $10) and Noesis (€9.99),
above Refrag Player ($7) and Scope Prematch ($7.99), and none of those write a coaching
report. The yearly price ($96, 20% off) matches the discount shape Refrag uses.

**Team at $300 per season** is about $100 a month over an eleven-week season, which is
above Refrag Team ($79 / month, $60 annual) and far above Teamwise (free). The product
justifies it only as a bundle: Refrag-style practice servers, coaching reports on every
team demo, scouting dossiers, and a stratbook with Discord approval, all in one place
and priced per team, not per seat ($60 per player per season on a five-stack). Two
cautions stay:

- **Practice servers cost real money** (DatHost bills per server-hour; the
  `vultr_instance_id` column is a legacy name, the provider is DatHost). Meter server
  hours into the season (for example 60 hours per season included, then $1.50 an hour)
  or a nightly-practice team turns the $300 into a loss.
- **Coaching runs cost per match.** Keep "unlimited uploads" but cap coaching re-runs
  per match.

Both lines are now measured per team on `/settings/admin` → Team metering
(`services/billing/metering.py`): every Gemini call writes an `llm_usage` row priced at
the configured per-million rates (Gemini 2.5 Flash $0.30 in / $2.50 out, Pro $1.25 /
$10.00, list prices checked 2026-09-29), and training-session hours are billed at the
configured server rate ($0.10 / h default; set it to DatHost's actual per-hour price for
the server size and location you provision).
The table shows cost, the $300 season revenue and the margin per team for this season,
30 or 90 days, or all time. Watch it for a season before deciding on server caps.

**Trials.** Seven days is the industry norm (Leetify and Refrag both use it). The trial
code system (`services/billing/promo.py`) issues weekly single-use codes for Solo Pro or
Team, and every user has a referral link that gives both sides seven days of Solo Pro.
Give Team trials sparingly: they include server time.

Sources (checked 2026-09-29): Refrag tier prices from search results citing refrag.gg;
Leetify Pro from a 2025 comparison at floatpeak.com and the Renown bundle at
distillintelligence.com; Scope Prematch from esports.gg; Noesis from search results
citing noesis.gg; Teamwise and RoundIQ from their own home pages.
