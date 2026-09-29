# Frontend Refactor Plan — one pass, root causes first

Supersedes the plan tables in `UX_REVIEW.md` (§4, §6.6, §7). That document keeps the
evidence: finding ids (S, H, D, T, M, P) below refer to it. This file is the plan of
record for the frontend; `ARCHITECTURE_REFACTOR_PLAN.md` is the backend counterpart and
owns the three backend items referenced here.

Decisions already taken by the owner, not reopened here:

- Three themes with CS2 as the default, CS:GO second, Great Khan third.
- Coaching mode chosen at upload, never as a global toggle.
- The debrief has three separate stages (parse → stats → coaching) and shows one
  screen per outcome. If coaching fails, the page shows the failure, not the stats.
- Scouting belongs to the team: it is uploaded from, and listed in, the Team Hub.
- **Solo Pro is $10 / month or $96 / year (20% off).**
- **Team is a hard paywall, sold per ESEA season.** Creating a team, team uploads,
  scouting, servers and Discord all require it: **$300 flat per season**, one payment,
  not a subscription. Seasons follow ESEA's calendar (S59 = 5 Oct – 20 Dec 2026, then
  projected four a year; `services/billing/seasons.py`). Access runs until the next
  season starts. Members of a team whose owner holds the season inherit its
  entitlements (seat inheritance already exists in `services/billing/entitlements.py`).
- `/settings/admin` returns 404 to non-admins.

## 1. Why one pass

The review produced about fifty findings. They collapse into six root causes. Fixing a
symptom at a time would touch the same files six times; fixing the causes touches each
file once. Each workstream below removes a cause, lists the findings it closes, and is
sized as one commit on one working branch.

| Cause | Symptoms it produces |
|---|---|
| **A. State lives in the wrong place.** Mode in `localStorage`, plan in Clerk metadata plus `flags.ts`, match lists and strats in hand-rolled polls. | M1–M8, H1, H6, S7, S8, D1, P1-3 |
| **B. No app shell.** Every page builds its own header, padding, background and nav spacing. | S3, S4, H2, H3, D3, D8, P0-3, D2 (heading clips, mobile overflow, sections invisible at rest) |
| **C. Identity is welded to one theme.** Khan components, literal hex, gold-means-two-things. | T1–T9, S5, P2-4 |
| **D. Routes without an owner.** Dead, mocked, or unguarded pages. | S1, S2, S10, S11, P0-1, P0-2, H5, H7 |
| **E. The debrief is one file.** 3,500 lines, two report systems, three tab levels, charts picked by habit. | D4–D7, P0-4, P2-1…P2-3, §2.4, §2.5, §2.8 |
| **F. No regression net for the UI.** Nothing caught S1 or the mobile overflow before a user would. | §0, S12 |

## 2. Target

### 2.1 Information architecture

```
Navbar   [mark] Home · Matches · Teams · Stratbook            [Upload] [avatar ▾]
         avatar menu (Clerk UserButton, themed): Settings · Plan · Theme · Sign out
         mobile: same four links in the sheet; Upload stays visible; nothing overflows

/                 Home: upload card (opens the mode picker), last 5 matches with a mode
                  badge, plan card. Was "War Room / Ready when you are".
/matches          all the user's matches, filter chips All · Personal · Team
                  (replaces /profile's list; scouting dossiers live in the Team Hub)
/analysis/[id]    debrief (route kept; the mocked /matches/[id] is deleted)
/teams            list (Team plan paywall when the user holds no plan and no seat);
                  /teams/[id]  hub with Overview · Opponents · Stratbook · Coach · Settings;
                  /teams/[id]/training
/stratbook        personal stratbook (unchanged)
/settings         Profile (Steam link) · Appearance (theme) · Plan & quota
/settings/admin   admin role only
/billing          pricing (signed-out reachable, no test-card copy)
deleted           /coach, /admin, /onboarding, /matches/[id] mock, /scouting (moved
                  into the Team Hub as Opponents), the Individual/Team toggle
```

§6 specifies every route in this tree: its one job, what it hosts and in what order,
its primary action, and its empty, loading and locked states.

### 2.2 Data flow

One rule: the server shapes, the client renders. Concretely:

- `mode` (`personal | team | scouting`) is a column of the match and appears on every
  match row, job payload and report. The client never derives it.
- `plan` and `entitlements` come from one Next.js route (`/api/me`) that reads Clerk and
  the FastAPI entitlement endpoint once; `flags.ts` becomes a display table (labels,
  prices) with no capability booleans.
- All reads are TanStack Query hooks in `lib/api/hooks.ts`; polling is
  `refetchInterval`, paused when the tab is hidden. The `coachingModeChange` event and
  the two other window-event buses are deleted.

### 2.3 Upload workflow (closes the mode confusion)

`UploadModal` becomes a two-step flow with one prop, `preset?: { mode, teamId? }`:

```
Step 1 — "Who is this analysis for?"
  [ Coach me ]            personal · needs a linked Steam ID
                          (no link → inline "Sign in through Steam" on the card; the
                           card cannot be chosen until it resolves)
  [ Coach my team ]       team · team selector (user's teams)
                          no Team plan → card shows "Team plan · $30/mo" and opens the
                          upgrade modal; no team yet (plan held) → "Create a team →"
  [ Scout an opponent ]   scouting · same team selector and the same gate; the demo is
                          filed under that team as an opponent dossier
Step 2 — drop zone, mode chip in the header, "Change" link back to step 1
```

The request body is unchanged (`team_id`, `is_recon`); the backend already derives the
mode from those, and `is_recon` wins, so a scouting upload always carries the team it
was scouted for. Callers only pre-select: Home → none, Team Hub "Upload a demo" → team
with its id, Team Hub → Opponents "Scout an opponent" → scouting with its id.

### 2.4 Theme system

```ts
// lib/theme-config.ts
interface ThemeDef {
  id: "cs2" | "csgo" | "khan";
  label: string; description: string;
  headingFont: "barlow" | "barlow-condensed" | "cinzel";   // loaded in layout.tsx
  mark: "radar" | "crosshair" | "soyombo";                 // logo + progress mark
  ambience: "none" | "scanlines" | "cloud";                // page background layer
}
```

- `:root` becomes the **CS2** palette: dark blue-grey surfaces, one orange accent for
  action, muted steel for secondary. The current Khan block moves under
  `[data-theme='khan']` unchanged. **CS:GO** is warmer and higher contrast: near-black
  surfaces, the CS:GO orange, condensed uppercase headings.
- `--color-ct` and `--color-t` are **the same in all three themes** (one CT blue, one T
  gold-orange); side colour is data, not brand.
- `--color-accent-secondary` stops meaning "team". Mode chips use a neutral chip style
  with an icon; gold stays rank/achievement.
- Identity components read `def.mark` / `def.ambience`: `ProgressMark` (radar sweep
  assembling for CS2, crosshair-and-bomb-timer for CS:GO, Soyombo for Khan), `BrandMark`,
  `Ambience`. `patterns/mongolian.tsx` is imported only by the Khan variants.
- Copy loses the Khan names except under the Khan theme, where a small `themeCopy()`
  helper can rename "Coaching report" to "The Khan's verdict" and so on. Product
  features are named by what they do everywhere else.
- Switcher: the Clerk `UserButton` gets a custom "Theme" menu item (radio of three), and
  `/settings` → Appearance has the full cards. Active state uses the current theme's
  tokens, not the target theme's hex.
- No Valve imagery. Palette, type and original motifs only.

### 2.5 App shell

`app/(app)/layout.tsx` wraps every signed-in route: `Navbar`, `Ambience`, a content
container with `padding-top: var(--nav-h)` and 16px gutters, `PageTransition`. Pages
stop importing backgrounds and stop reserving space for the navbar themselves. A
`PageHeader` primitive (eyebrow, title, subtitle, actions) replaces the per-page
headers; it stacks on mobile. A `SectionTabs` primitive (`role="tablist"`, scrollable on
mobile) replaces the four ad-hoc tab rows (debrief, team hub, training, stratbook).

### 2.6 Debrief

`app/analysis/[jobId]/page.tsx` keeps polling, status and layout only. Sections live in
`components/debrief/` and register themselves:

```
Header        map · clan names or top fragger · score · Grade D · 48 · MODE BADGE · date
SectionTabs   Report · Rounds · Duels · Players   (mobile: one section at a time;
                                                   desktop: anchors, all visible at rest)
FilterRow     round selector shared by every chart below (one filter row, dataviz rule)
Report        CoachingCard (server-shaped: full / redacted / teaser), findings deep-link
              to #rounds with the row highlighted; "Full text report" drawer
Rounds        RoundTimeline, EconomyChart (two 2px lines, no fills, halftime rule)
Duels         OpeningDuels (sorted bars), DuelExplorer paginated by round (no inner scroll)
Players       PlayersTable (stat table; radar replaced by sorted bars)
Map           KillMap for the selected round(s), map underlay, one heading
```

Replay stays quarantined at `/analysis/[id]/replay` and is linked from the Map section.

The page is a state machine over the job's three stages, one screen per state:

```
parse running   → Waiting screen (ProgressMark, stage labels, queue position)
parse failed    → Parse-failed screen: the parser's message, "Upload a different demo"
stats running   → Waiting screen, second stage lit (telemetry v2 + baselines)
coaching running→ Waiting screen, third stage lit
coaching failed → Coaching-failed screen: why (quota, model, verification), "Re-run",
                  "Back to matches". No stats sections render.
done            → the debrief above, in the mode the server recorded
```

`/api/jobs/{id}` must expose the stage and the failure reason as data (B1), so the
page never infers a state from which fields happen to be present.

## 3. Workstreams, in order

Each row is one commit on the working branch. "Closes" cites `UX_REVIEW.md` ids.
Backend rows are owned by `ARCHITECTURE_REFACTOR_PLAN.md` §3.4–3.6 and land first.

| # | Workstream | Files (main) | Closes | Size |
|---|---|---|---|---|
| W0 | **Guard and delete.** Admin role check in `app/api/admin/*` (both verbs) and redirect on `/settings/admin`; delete `/coach`, `/admin`, `/onboarding`, `/matches/[id]`; remove test-card copy; `proxy.ts` matcher covers `/settings`, `/matches`, `/stratbook`. | `app/api/admin/*`, `app/settings/admin`, `proxy.ts`, `app/billing` | S1, S2, S10, S11, P0-1, P0-2 | S |
| B1 | Backend: `mode` on `/api/analyses` and `/api/jobs/{id}`; job `stage` + `failure_reason` on `/api/jobs/{id}`; `require_entitlement(TEAM_ANALYSIS)` on team create and server routes; admin role passthrough header. Done 2026-09-29: `/api/billing/entitlements`, `/api/billing/seasons`, season purchases in `/api/billing/sync`, promo/referral codes, checkout `interval` + one-time Team payment. | `api/routes/analyses.py`, `jobs.py`, `teams.py`, `servers.py` | M6, M7 | S |
| W1 | **Server truth.** `/api/me` route (plan, entitlements, steam link, teams); `useMe`, `useMatches`, `useTeam`, `useStrats` hooks with `refetchInterval`; delete the three window-event buses and `localStorage.coaching_mode`; `flags.ts` display-only. | `lib/api/hooks.ts`, `lib/api/client.ts`, `lib/flags.ts`, `Navbar`, `app/page.tsx`, `app/teams/[teamId]/page.tsx` | M1, M3, M5, H6, P1-3 | M |
| W2 | **Upload workflow.** Two-step `UploadModal` with the mode picker (§2.3), Steam-link gate, team selector, locked cards; `preset` prop replaces `defaultMode`; callers updated; mode badge component. | `components/upload/{UploadModal,ModePicker,ModeBadge}.tsx`, `UploadZone.tsx`, Home, Team Hub | M2, M4, M8, H1, S7, S8, D1 | M |
| W3 | **App shell + IA.** `(app)/layout.tsx`, `PageHeader`, `SectionTabs`, themed Clerk `UserButton` with menu items; `/matches` (from `/profile`), Team Hub gains the Opponents tab (from `/scouting`) and the plan paywall on `/teams`, `/settings` with three sections; nav rename; mobile sheet. | `app/(app)/layout.tsx`, `components/ui/{PageHeader,SectionTabs}.tsx`, `Navbar`, `app/matches`, `app/settings`, `app/teams/*` | S3, S4, S5, S6, S9, H2, H3, P1-2 | L |
| W4 | **Theme system.** Token restructure (CS2 root, Khan block, CS:GO block, fixed side colours), `ThemeDef` slots, `ProgressMark` / `BrandMark` / `Ambience`, `themeCopy()`, switcher in avatar menu and Appearance; tokenize the pages the shell did not already fix (Teams list, servers page, planning board). | `app/globals.css`, `lib/theme-config.ts`, `lib/themes.ts`, `components/identity/*`, `components/ThemeSwitcher.tsx`, `app/layout.tsx` (fonts) | T1–T7, T9 | L |
| W5 | **Debrief split and rebuild.** Pure move into `components/debrief/*` (commit 1, `tsc` as the net), then §2.6 (commit 2): header with clan names and grade label, section tabs, shared filter row, chart pass per `dataviz`, deep-link fix, replay link, visible at rest, tokenized. | `app/analysis/[jobId]/page.tsx`, `components/debrief/*`, `components/analysis/*` | D2–D8, T8, P0-4, P2-1…P2-4 | L |
| W6 | **Regression net.** Three-theme screenshot matrix (`--project=shots*` × `data-theme`), Team Hub and debrief captures in CI on a schedule (not per PR: they hit the deployed app), `hscroll=YES` and `errors>0` become assertions, 11px label lint rule. | `e2e/*`, `playwright.config.ts`, `.github/workflows` | S12, F | M |

W0 and B1 can ship today on their own. W1→W2 must be sequential. W3 and W4 both touch
`Navbar` and `globals.css`; do W3 first so W4 styles the final shell. W5 is independent
of W3/W4 except for `SectionTabs` and tokens, so start it after W3 lands and rebase on W4.

## 4. Definition of done, per workstream

1. `npm run lint && npx tsc --noEmit` clean; no new literal hex (`grep -cE
   '#[0-9A-Fa-f]{6}\b'` per touched file did not go up; W4/W5 drive it to zero).
2. Capture suite green: `--project=shots --project=shots-mobile --no-deps`, plus
   `team-shots*` for W2/W3 and `debrief-shot` for W5. No `hscroll=YES`, no page errors.
3. Screenshots eyeballed at 1440 and 390, in all three themes from W4 onward.
4. The skill checklist in `.claude/skills/demosage-frontend/SKILL.md`.
5. Merge to `main` only after the full CLAUDE.md check list passes on the branch.

## 5. What this does not do

- Rename `/analysis/[id]` to `/matches/[id]`. Existing links and the e2e suite use the
  current path; the gain is cosmetic.
- Rewrite the Team Hub's four tabs beyond the shell primitives. Its structure is the
  best in the app (H9); it gets the shell, the upload preset and the tokens, no more.
- Build the entitlement logic itself; W1 consumes what B1 exposes. B1 does add the two
  Team prices and the `interval` on checkout, since the pricing page needs them.
- Touch the replay lab; it stays beta behind its own route.

## 6. Page map

Method (from the `artifact-design` fundamentals and the project skill's page rules):
each page has **one job for one reader**; it is scanned, so **summary comes before
detail**; state is shown in form (chip, stripe, badge) as well as in numbers; the page
is **complete at rest** (nothing waits for a scroll or an observer); every empty state
names the next action; copy is written from the player's side. Each entry below ends
with "one detail only this subject has", the artifact-design rule that keeps a page
from reading as a template.

Legend for the "Hosts" lists: order on the page is the order in the list. `[hook]` is
the TanStack Query hook that feeds the block (§2.2).

### 6.1 `/` signed out — Landing

- **Job**: convince a CS2 player to upload one demo. Reader: someone who arrived from a
  link and has 20 seconds.
- **Hosts**: hero (headline, one sentence, "Upload a demo" → sign-up); a 3-step strip
  (Upload · We parse and compare against pro play · You get a debrief) with real numbers
  from the pipeline (rounds parsed, findings per match); one screenshot of a real
  debrief; pricing summary with the three tiers and a link to `/billing`; footer.
- **Primary action**: Sign up. Secondary: Pricing.
- **States**: none dynamic. Everything visible at rest (P0-3).
- **Detail only this subject has**: the 3-step strip quotes a real finding with its
  round and tick reference ("R14 · 1:07 · late rotate from B").
- **Drops**: the four agent cards named Scout / Library / Tactician / Khan. Under the Khan
  theme `themeCopy()` may restore those names as flavour; the default names features by
  what they do.

### 6.2 `/` signed in — Home

- **Job**: get the next demo in, and get back to the last one. Reader: a returning
  player between matches.
- **Hosts**: `PageHeader` ("Home", subtitle names the plan and quota: "Free · 1 of 2
  uploads left this month"); Steam-link notice only while unlinked (one line, one
  button); **upload card** (drop zone; a drop or click opens the mode picker §2.3);
  **last five matches** `[useMatches({limit: 5})]` as rows: map, score, grade chip,
  **mode badge**, relative date, status stripe for queued/processing; "All matches →";
  plan card (only for Free and Solo Pro: what the next tier unlocks, "See plans").
- **Primary action**: Upload. Secondary: open the latest match.
- **States**: loading → skeleton rows (no spinner text); empty → "No matches yet. Your
  first upload starts here." with the upload card already in view; processing rows show
  the pipeline stage inline ("Parsing · 40%").
- **Detail only this subject has**: the grade chip uses the report's letter and score
  (D · 48) with the same colour scale as the debrief header.
- **Drops**: "War Room", "Ready when you are", the Teams / Stratbook / Scouting tiles
  (the navbar already does that), the mode sentence.

### 6.3 `/matches` — Matches

- **Job**: find one match among many. Reader: a player or captain looking for a specific
  game, or checking what is still processing.
- **Hosts**: `PageHeader` ("Matches", count); **filter row** (chips: All · Personal ·
  Team; a team selector when the user has more than one team; a map select). Scouting
  demos are not in this list: they are opponent dossiers and live in the Team Hub;
  **table** `[useMatches(filters)]`: map, teams (clan names or "you + 9"), score, grade,
  mode badge, uploaded by (team matches), date, status; row click → debrief; kebab →
  delete (confirm inline), re-run coaching.
- **Primary action**: open a match. Secondary: Upload (navbar).
- **States**: empty per filter ("No team matches yet. Upload one from your Team Hub."
  with the link); loading → skeleton table; failed rows show the stage that failed
  ("Coaching failed · quota") and "Retry".
- **Detail only this subject has**: score cell is `13–7` in mono with the user's side
  first when known, coloured by `--color-ct` / `--color-t` for the starting side.
- **Absorbs**: `/profile`'s list. `/scouting` moves to the Team Hub (§6.7 Opponents).

### 6.4 `/analysis/[id]` — Debrief

- **Job**: tell the player what to fix before the next match. Reader: the uploader
  (personal), the roster (team), the captain (scouting). The mode decides which tab set
  and which report the page renders; the page never guesses.
- **Hosts**: `Header` (map, clan names or top fragger, score with side colours, **grade
  chip with label**, mode badge, date, "Notes" button, "Re-run" in a kebab);
  `SectionTabs` Report · Rounds · Duels · Players · Map (anchors on desktop, one section
  at a time on mobile); **FilterRow** (round selector; "All rounds" default; a selection
  scopes every chart below); **Report**: `CoachingCard` in the server's shape (full,
  redacted with the locked count and one unlocked finding, or teaser), findings as
  `InsightCard`s whose round links jump to `#rounds` with the row highlighted, "Full text
  report" drawer, per-player reports as an accordion in team mode, opponent tendencies
  in scouting mode; **Rounds**: `RoundTimeline` (win/loss per round, halftime, bomb
  plants), `EconomyChart` (two lines, halftime rule, hover crosshair); **Duels**:
  `OpeningDuels` (sorted bars, legend), `DuelExplorer` paginated by round; **Players**:
  stat table (K/D, ADR, HS%, utility damage, flash assists, trade rate) sortable, mono
  digits; **Map**: `KillMap` for the selected rounds on the map underlay, "Open replay
  (beta)".
- **Primary action**: read the top finding. Secondary: filter a round; open the replay.
- **States** (one screen each, see §2.6): **waiting** for any running stage:
  `ProgressMark` for the theme, the three stage labels with the current one lit, queue
  position, "We'll keep this page updated"; **parse failed**: the parser's message,
  "Upload a different demo"; **coaching failed**: the reason (quota, model,
  verification dropped every finding), "Re-run", "Back to matches", and nothing else
  on the page; **done**: the full debrief. Within done: **locked** (Free) shows the
  teaser card with everything else full; **personal mode without a Steam link** cannot
  happen after W2, but old matches show "Analysed before your Steam ID was linked" on
  the card.
- **Detail only this subject has**: every finding carries its `R#` and tick as a chip,
  and the chip is the deep link.
- **Drops**: the legacy Individual/Team tab pair driven by the global toggle, the
  duplicate kill-positions heading, the inner scroll on duels.

### 6.5 `/analysis/[id]/replay` — Replay lab (beta, unchanged)

- **Job**: scrub the 2D radar of one round. Reader: a player checking one moment.
- **Hosts**: `TacticalRadar`, `PlaybackControls`, `TickScrubber`, `Killfeed`; round
  selector; "Back to debrief". State in the Zustand playback store.
- **States**: telemetry loading, round without telemetry ("Not captured for this round").
- **Rule**: linked only from the debrief's Map section, labelled beta.

### 6.6 `/teams` — Teams

- **Job**: pick or create a team. Reader: a player who wants team features.
- **Hosts**: `PageHeader` ("Teams", "Create team" and "Join with code" actions that
  open an inline form, not a page); **team cards** `[useTeams]`: logo or hashed mark,
  name, member count, your role chip, last match date; click → hub.
- **Primary action**: open a team; when none, "Create your first team".
- **States**: empty (as today, keep it); creating/joining inline with errors inline;
  **without the Team plan** the page is a paywall: the empty state explains what a team
  gets (shared demos, scouting, servers, stratbook with Discord), the price ($30 / month
  or $300 / year), and one "Choose Team" button. Create and Join are disabled with the
  plan chip. Joining an existing team whose owner holds the plan works on any tier
  (seat inheritance), so the Join form stays reachable through an invite link.
- **Detail only this subject has**: role chips use CS terms (Captain · Player · Coach).

### 6.7 `/teams/[id]` — Team Hub

- **Job**: run one team from one place. Reader: the captain mostly; players for the
  roster and matches.
- **Hosts**: `PageHeader` (logo, name, member count, role chip, "← Teams");
  `SectionTabs` Overview · Opponents · Stratbook · Coach · Settings.
  - **Overview**: members list with invite (code shown with a Copy button; copy failure
    shows the code selected, never "Copied!" without success); **team matches**
    `[useMatches({teamId})]` (same rows as §6.3) with "Upload a demo" → picker pre-set
    to *Coach my team* with this team; practice servers (running servers with connect
    string, "Spin up a server" → training page); latest approved strats (3) →
    Stratbook tab.
  - **Opponents** (was `/scouting`): dossiers `[useMatches({teamId, mode: "scouting"})]`
    grouped by opponent (clan name from the demo, editable), each with map, date and the
    dossier's headline tendency; "Scout an opponent" → picker pre-set to scouting with
    this team; empty state: "No dossiers yet. Upload an opponent's demo and we'll
    profile their buys, defaults and habits."
  - **Stratbook**: strategy library (list with status chips Draft · In review · Active
    · Archived, map filter, search) `[useStrats(teamId)]`; the planning board for the
    selected or new strat; Discord connect card (state: not connected / connected to
    #channel / sync outbox pending count).
  - **Coach**: the team chat `[useTeamChat]` with the match list it can reference (team
    scrims and members' personal matches, labelled); sample prompts written from the
    team's own data ("Why did we lose 6 of 8 pistol rounds on Anubis?") instead of pro
    team names.
  - **Settings**: name, logo (hashed fallback mark, no lore card), members (roles,
    remove), Discord link, danger zone (leave, delete with typed confirm). No
    "Password", no "Subscription" (plan lives on `/settings`).
- **Primary action**: per tab: Upload a demo · Scout an opponent · New strat · Ask ·
  Save.
- **States**: the tab row scrolls on mobile; every tab has an empty state that names
  the next action (they already do). The hub is reachable only with the Team plan or as
  an inheriting member; a lapsed owner's team shows a read-only banner ("Your Team plan
  ended on <date>. Renew to upload, scout or run servers") and the actions are disabled.
- **Detail only this subject has**: strat status chips mirror the backend state
  machine exactly, so a captain sees "In review" the moment Discord approval is pending.

### 6.8 `/teams/[id]/training` and `/teams/[id]/servers/[serverId]`

- **Job**: start a practice server in one of ten modes, then control it. Reader: the
  captain or whoever runs practice.
- **Training hosts**: `PageHeader` stacked on mobile ("Training", "← Team"); **launch
  row** (mode, region, map, "Start session"), disabled until a mode is picked with the
  reason inline; mode grid (the ten cards, image, two tags) → picking fills the launch
  row; Statistics tab (sessions, minutes, per-mode counts).
- **Server hosts**: status stripe (starting / running / stopping), connect string with
  Copy, RCON console (`ServerControlPanel`), map and mode switch, "Stop server" with
  confirm, cost/time running.
- **States**: only reachable with the Team plan (the hub gate covers it); provisioning
  → progress with the provider's stage; error → provider message and "Try another
  region".
- **Detail only this subject has**: connect string is a real `connect ip:port; password
  x` line in mono, copyable in one click.

### 6.9 `/stratbook` — Personal stratbook

- **Job**: sketch a setup and get it critiqued against pro playbooks. Reader: a solo
  player or an IGL working alone.
- **Hosts**: `PageHeader` ("Stratbook", title input, "Save", "Get critique");
  **board** (map select, tools row, canvas) full width; **critique panel** below on
  mobile, beside on desktop, with the response streaming into it; saved strats list
  (map, title, date) `[useUserStrats]`.
- **Primary action**: Get critique. Secondary: Save.
- **States**: empty board hint; critique loading (skeleton, not a spinner sentence);
  critique locked on Free (teaser: first paragraph, then the plan chip).
- **Detail only this subject has**: the tools row uses CS utility names and their real
  colours as fixed tokens (Smoke · Flash · HE · Molotov), the same in every theme.
- **Fix**: page top padding under the navbar; stacked header on mobile (S4).

### 6.10 `/settings` — Settings

- **Job**: change the things about *me*. Reader: any signed-in user, rarely.
- **Hosts**: `SectionTabs` Profile · Appearance · Plan.
  - **Profile**: display name (from Clerk), email, **Steam link** (status, "Sign in
    through Steam", manual ID entry, unlink), FACEIT link if kept, Clerk "Manage
    account".
  - **Appearance**: the three theme cards with live swatches (§2.4), reduced-motion
    respect note, weapon-skins plugin toggle (moved from today's `/settings`).
  - **Plan**: current tier and its source (paid, trial ending <date>, or free), quota
    meter (uploads used / limit, reset date), history retention, "Manage billing"
    (Stripe portal) or "See plans"; the **Invite a friend** card (`InviteCard`: the
    user's referral link, both sides get a week of Solo Pro) and the **Redeem a code**
    box, which live on `/profile` today and move here with the rest.
- **Primary action**: per tab.
- **States**: Steam link pending (returning from OpenID), failure with the reason.
- **Detail only this subject has**: the Steam card shows the linked profile's avatar
  and persona name so the user can confirm it is the right account.
- **Absorbs**: `/profile`'s Steam card, theme picker and plan tiles. `/profile` redirects
  here.

### 6.11 `/settings/admin` — Admin

- **Job**: tune the coaching pipeline. Reader: the owner only.
- **Hosts**: ingestion status (last HLTV run, last social run, queue depth); LLM
  parameters (model, temperature); the four prompt editors with a diff against the
  default and "Reset to default"; grounding metrics once §3.5 of the backend plan lands
  (drop-rate, citation coverage).
- **States**: non-admin → 404 (not a redirect that reveals the page exists); save
  conflict → shows who changed it.
- **Guard**: server-side on both API verbs (W0). The page check is a courtesy.

### 6.12 `/billing` and `/billing/success`

- **Job**: choose a plan. Reader: signed-out visitors and Free/Solo Pro users.
- **Hosts**: a **Monthly / Yearly** toggle (Solo Pro only); three tier cards. Prices:
  Free $0; **Solo Pro $10 / month or $96 / year** ("save 20%"); **Team $300 per ESEA
  season**, one payment, the card names the season on sale with its dates ("ESEA
  Season 59 · Oct 5 – Dec 20", "dates to be confirmed" when projected) and reads
  "You have Season 59" once bought. Team's list makes the paywall explicit: create a
  team, seats for the roster, opponent scouting, practice servers, stratbook with
  Discord. One line explaining that Team access runs until the next season starts;
  FAQ (3 questions: what counts as an upload, how seats work, refunds). Shipped
  2026-09-29 in `app/billing/page.tsx`; W3 restyles it on the shell.
- **States**: signed out → buttons go to sign-up then checkout; checkout error toast.
- **Success**: "You're on Team" with the three things to do next (Create a team, Upload
  a team demo, Link Discord), each a button.
- **Drops**: test-card copy; "2 demo uploads total" (it is monthly); the $20 Team price.
- **Depends on**: three Stripe prices in the dashboard (`docs/pricing.md` lists the
  exact steps); the checkout route already takes `interval` and runs Team as a
  one-time payment for the purchasable season.

### 6.13 `/sign-in`, `/sign-up`

- Clerk components inside the app shell with the theme's `appearance` (dark surface,
  accent, fonts). The sign-up redirect goes to `/` (Home), which already shows the
  Steam notice; `/onboarding` is deleted.

### 6.14 Overlays (not routes)

- **Upload modal** (§2.3): two steps, mode picker then drop zone; progress stages
  inline (compressing · uploading · queued) with a cancel; on completion it navigates
  to the debrief's waiting state.
- **Upgrade modal**: the tier that unlocks the feature the user just clicked, the one
  sentence of what it adds, "Choose <tier>", "Not now".
- **Theme menu item** in the Clerk user button: three radio rows with swatches.
- **Toasts** for every mutation result; never `alert()`.

### 6.15 Removed, and where their one useful part went

| Route | Useful part | Goes to |
|---|---|---|
| `/coach` | a chat about your demos | Team Hub → Coach (has a live endpoint) |
| `/admin` | service health | `/settings/admin` ingestion status (real data) |
| `/onboarding` | link Steam and FACEIT | `/settings` → Profile, plus the Home notice |
| `/matches/[id]` (mock) | nothing | deleted; `/matches` is the list |
| `/scouting` | recon match list | Team Hub → Opponents (scouting is a team feature) |
| `/profile` | list, Steam card, theme, plan | `/matches` and `/settings` |
| Individual/Team toggle | choosing a mode | upload modal step 1 |
