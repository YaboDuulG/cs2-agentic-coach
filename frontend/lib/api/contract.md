# Frontend API contract (Next.js proxies → FastAPI), 2026-10-01

Reference for pages: what `app/api/**` returns. Produced by reading every proxy and the
FastAPI handler behind it. Shapes are TypeScript-style. `lib/api/hooks.ts` wraps these.

Conventions: proxies call Clerk `auth()` (401 `{error:"Unauthorized"}` without a session)
and forward `Authorization: Bearer API_SHARED_SECRET`. Identity reaches FastAPI as
`?user_id=`, a `user_id` body field, or the `x-clerk-user-id` header depending on the
route. FastAPI errors are `{detail: string | object}`; proxy-generated errors are
`{error: string, detail?: string}`. Datetimes are ISO strings without `Z`.

## Upload
- `POST /api/upload` body `{filename, size_bytes?, team_id?, chunk_count?, is_recon?, fingerprint?}` →
  `{job_id, match_id, duplicate:true, demo_status}` | `{job_id, match_id, upload_url, gcs_path, local_mode}` |
  `{job_id, match_id, upload_urls[], gcs_path, local_mode}`. Errors: 429 `{error, upgrade_url}` (monthly quota from Clerk
  `publicMetadata.uploadsThisMonth`), 400, 413, 403 (team membership), 502.
- `POST /api/upload/compose` `{match_id, filename, chunk_count, team_id?}` → `{ok, match_id, gcs_uri}`.
- `POST /api/upload/complete` `{match_id}` → `{ok, match_id}` (queues the parse).

## Jobs & matches
- `GET /api/jobs/[id]?light=1` → union on `status`:
  `queued {match_id, created_at?, elapsed_seconds?, is_recon}` · `processing {match_id, map, created_at, elapsed_seconds, is_recon}` ·
  `failed {match_id, error: string|null, is_recon}` (timeout after 900s: "Job timed out after 15 minutes") ·
  `done {match_id, map, parse_duration_seconds, is_recon, [full only:] total_rounds, total_kills, total_grenades,
  player_stats: Record<steamid64,{name, team:"CT"|"TERRORIST"|"", clan}>, kills: Kill[], rounds: Round[]}`.
  `Round {round (sequential), winner:"CT"|"T", ct_spend, t_spend}`;
  `Kill {killer, victim, weapon, round, killer_team, victim_team (STARTING sides), attacker_x/y, victim_x/y,
  attacker_steamid, victim_steamid, tick, headshot}`. Kills capped at 600. Access denial currently surfaces as 500.
  Since 2026-10-01 (`api/routes/jobs.py` `coach_state`) every variant also carries the coaching stage:
  `stage: "parse"|"coach"|"done"|"failed"` and, once parsed, `coach_status: "pending"|"running"|"done"|"failed"`,
  `coach_error: string|null`, `coach_attempts: number`. `status` is the parse; `stage` is the pipeline. The debrief
  (`components/debrief/Debrief.tsx` `screenFor`) renders one screen per combination; a coaching failure never shows stats.
  Backends older than this (staging until `main` is merged) omit the fields and the page falls back to `useCoaching`.
- `GET /api/jobs/[id]/rounds/[n]/telemetry` → `{match_id, round (raw DB round_num), map, tickrate, players[{player: steamid64, team:"", points[{tick,x,y,z}]}],
  kills[...], grenades[{thrower, type, tick, x, y}]}`.
- `GET /api/analyses?scope=personal|team|all` → `[{match_id, map, status, created_at, is_recon, team_id, mode}]` newest first (≤100). `[]` on error.
- `GET/POST /api/analyses/[id]/notes` → `{notes}` / `{status:"success", notes}` (POST re-runs coaching).

## Coaching
- `GET /api/coaching/[id]` → 202 `{status:"pending", match_id}` | 200 `{status:"ready", match_id, coaching, tier, is_recon}`.
  `coaching` = full | FREE-redacted | teaser:
  - `report_v2 {mode, summary{score, grade, headline}, key_findings[{round, rounds[], tick, category, severity:"HIGH"|"MEDIUM"|"LOW",
    observation, evidence_ids[], grounded_pro_benchmark, actionable_drill, audience}], paywalled_preview: null | {hidden_insights_count, upgrade_cta, locked?, tier_needed?}}`
  - FREE: `key_findings` = one top finding `{round, category, severity, observation}`, `individual_report`/`coach_report` = "### Match Summary…", others "### Locked…".
  - Teaser (team/scouting without the tier): `report_v2 {mode, summary{grade}, finding_categories{cat:count}, key_findings:[], paywalled_preview{locked:true, tier_needed:"TEAM", …}}`.
  - Legacy: `individual_report, team_report, player_reports{name: md}, strat_card, coach_report, findings[], summary`.
  Categories: UTILITY_USAGE · POSITIONING · TRADE_SPACING · OPENING_DUELS · ECONOMY · ROTATION.

## Teams
- `GET /api/teams` → `[{team_id, name, invite_code, is_owner, created_at, member_count, logo_url}]`.
- `POST /api/teams` `{name}` → `{team_id, name, invite_code}`.
- `GET /api/teams/[id]` → `{team_id, name, invite_code, owner_user_id, created_at, logo_url, members[{user_id, role:"owner"|"member", joined_at}]}`.
- `PATCH /api/teams/[id]` `{name?, logo_url?}` → `{status:"updated"}` (403 non-captain). `DELETE` → `{status:"deleted"}` (owner only).
- `POST /api/teams/[id]/logo` multipart `file` → `{logo_url}`.
- `POST /api/teams/join` `{invite_code}` → `{team_id, name, status:"joined"}` (404 "Invalid invite code").
- `GET /api/teams/[id]?view=analyses` → `[{match_id, map, status, created_at, user_id, is_recon, mode, total_rounds}]`.

## Servers & training
- `GET /api/servers/modes` → `{modes[{key, description, game_mode}], update_window_active, update_detail}`.
- `GET /api/teams/[id]/servers` → `Server[] {id, status:"booting"|"active"|…, ip_address:"host:port"|null, rcon_password, server_password, mode, expires_at}`.
- `POST /api/teams/[id]/servers` `{mode?, region?:"eu"|"na", map?}` → `Server`. Errors 400 (active server exists / bad mode), 402 `{detail: string}` (DatHost credits), 503 (Valve update window).
- `DELETE /api/servers/[id]` → `{status:"terminated"}`.
- `GET/POST /api/teams/[id]/training-sessions` → `{sessions[{id, team_id, user_id, server_id, mode, map_name, region, started_at, ended_at, duration_seconds, job_id}], total_sessions, total_seconds, favourite_mode, sessions_this_week}` / `Session`.

## Strats & stratbook
- `GET /api/teams/[id]/strats` → `[{id, team_id, title, map_name, side:"T"|"CT", buy_type, status:"DRAFT"|"IN_REVIEW"|"ACTIVE"|"ARCHIVED", current_revision_id, discord_thread_id, created_by, created_at, updated_at}]`.
- `GET /api/strats/[id]` → strat + `revisions[{id, revision_no, canvas{steps[{label, positions, utility[]}], callouts[]}, description, utility[], author_id, source, created_at}]`.
- `POST /api/strats/[id]/transition` `{status}` → strat (409 on a disallowed transition). `POST /api/strats/[id]/bind-code` → `{team_id, code}` (owner only; 503 if Discord unconfigured).
- `GET/POST /api/teams/[id]/strategies` → `[{id, content, created_at, title, map_name, side, author, summary, steps[], raw_content}]` (RAG rows).
- `POST /api/teams/[id]/strategies/chat` `{message, history?[{role, content}], map_name?}` → `{response}`.
- `POST /api/stratbook/user` `{map_name, title, strategy_json}` → `{status, id}`. `GET /api/stratbook/user` → `{strategies[{id, map_name, title, strategy_json, created_at}]}`.
- `POST /api/stratbook/critique` `{map_name, strategy_json}` → `{critique}`.

## Billing
- `GET /api/billing/entitlements` → `{user_id, tier, entitlements[], status, current_period_end, season, season_until, source:"season"|"stripe"|"trial"|"none"}`.
- `GET /api/billing/seasons` (public) → `{purchasable: Season, seasons: Season[], price_usd}`; `Season {number, label, start, end, access_until, projected, price_usd}`.
- `GET /api/billing/referral` → `{code, uses, invitee_days, referrer_days, tier, share_url}`.
- `POST /api/billing/redeem` `{code, source?}` → `{ok, code, kind, tier, plan, days, until, referrer_rewarded}`; 400 `{error, code: invalid|expired|exhausted|already_redeemed|own_code|not_new|referral_used|already_subscribed}`.
- `POST /api/billing/checkout` `{plan:"basic"|"pro", interval?}` → `{url}`; 409 `{error, code:"already_owned"}`, 500 when a price id is unset.

## Admin (404 for non-admins)
- `GET/POST /api/admin/configs` → `Record<string,string>` / `{status}`. Keys: coaching_model, coaching_temperature, prompt_*, last_*_ingest_run, llm_price_*, server_hourly_cost_usd.
- `GET /api/admin/dathost-account` → `{available:true, credits, currency, email, servers_on, fields}` | `{available:false, reason}`.
- `GET/POST /api/admin/promo-codes` → `{codes[{code, kind, tier, days, max_uses, uses, expires_at, active, note, created_at}]}`; POST `{count?, tier?, days?, max_uses?, valid_days?, note?}`.
- `GET /api/admin/team-metering?window=season|30d|90d|all` → `{window, since, server_hourly_cost_usd, teams[{team_id, name, owner_user_id, members, season, season_until, season_active, matches, llm_calls, input_tokens, output_tokens, llm_cost_usd, server_sessions, server_hours, server_cost_usd, revenue_usd, total_cost_usd, margin_usd}], unattributed_llm{calls, cost_usd}, totals{llm_cost_usd, server_cost_usd, revenue_usd, margin_usd}}`.

## Steam
- `GET /api/steam/login` → redirect to Steam. `GET /api/steam/callback` → redirects to `/settings?steam=linked|error&reason=…`.
- `GET /api/steam/profile?steamid=` → `{steamid, personaname, avatar, avatarmedium, avatarfull, profileurl, playtime_forever, playtime_private}`.
- `GET /api/steam/resolve?url=` → `{steamid}`.
- Steam ID lives in Clerk `unsafeMetadata.steam_id`; the plan display cache in `publicMetadata.plan|plan_source|plan_season|plan_expires`.

## Known wiring facts
- Telemetry `players[].player` is a SteamID64 with `team: ""`; join with `player_stats` from the job payload for names and sides.
- Job round numbers are sequential after filtering; telemetry uses raw DB round numbers.
- Server creation 402 is a plain string (DatHost credits), not upgrade metadata. Upload quota is a 429 from the proxy.
