# Frontend UX Review — why it is hard to use, and what to change

Reviewed 2026-09-29 against `main` (`023e587`). Companion to `DESIGN_PLAN.md` (the design
system of record) and `../ARCHITECTURE_REFACTOR_PLAN.md` §3.6.

## 0. How this was produced

> Update 2026-09-29: signed-in captures now exist — see §7 for the spec and findings.

- Read: every page under `app/`, `Navbar`, `UploadZone`/`UploadModal`, the data layer
  (`lib/api/*`, `lib/flags.ts`, `lib/themes.ts`), `proxy.ts`, all `components/analysis/*`,
  the e2e specs.
- Ran: `npx tsc --noEmit` (clean once `npm install` restored `recharts`/`@playwright/test`
  and the stale `.next/types` was removed), `npm run lint` (0 errors, 20 warnings).
- Looked at: the deployed app signed-out at 1440px and 390px (`/` and `/billing`),
  reduced-motion on. No horizontal overflow at either width.
- Not verified: any signed-in page rendered in a browser. There are no local Clerk keys
  and no saved Playwright session; creating a test user was out of scope. Everything
  said about signed-in pages comes from reading the code.
- Method: the `artifact-design` fundamentals (page complete at rest, structure encodes
  information, copy from the user's side, one signature moment) and the `dataviz` form
  and anti-pattern checks were applied to each surface. See §5 for skills to install.

## 1. The diagnosis in one paragraph

The product has one good journey — upload, wait on the Soyombo, read the debrief — and
it is wrapped in navigation and state that fight it. A global Individual/Team switch in
the navbar silently changes what the home page lists, what an upload means, and which
report an already-finished analysis shows. The nav labels do not name their destinations
(Analyses is the profile page; Dashboard is the home page; Settings is unreachable). Five
routes are dead or mocked but still ship. The debrief page is a 3,500-line file carrying
two report systems and three levels of tabs. Fixing the structure (§3) matters more than
any visual polish; the design system in `DESIGN_PLAN.md` is fine and mostly unused on the
pages that matter.

## 2. Findings

Ordered by how much they cost a user. File references are where to look.

### 2.1 Mode is global state, but it is a property of a match

- The navbar toggle writes `localStorage.coaching_mode` and broadcasts a `CustomEvent`.
  Three components re-implement the same bus: `components/Navbar.tsx:33-58`,
  `app/page.tsx` (`CommandCenter`), and `CoachingPanel` in
  `app/analysis/[jobId]/page.tsx:787-812`.
- Consequence: open a finished personal analysis, flip the toggle to Team, and the report
  panel re-labels itself "Great Khan Team Strategy" and switches to team tabs for a match
  that was analysed in personal mode. The server already knows the mode
  (`report_v2.mode`); the client overrides it with a preference.
- The upload modal tells the user to "switch modes with the toggle in the navbar"
  (`components/UploadModal.tsx:62-65`) instead of letting them choose there.
- Fix: choose the mode in the upload modal (three explicit options: Coach me, Coach my
  team, Scout the opposition — the backend already has `team_id` and `is_recon`), show it
  as a badge on the analysis row and the debrief header, and delete the global toggle.
  List pages get a filter chip row (All / Personal / Team / Scouting) instead.

### 2.2 Navigation labels do not match destinations

- `Navbar.tsx:15-21`: "Dashboard" → `/`, "Analyses" → `/profile`. `/profile` is a
  profile page: Steam linking, plan and quota, theme switcher, teams, and the analyses list
  (`app/profile/page.tsx`, 680 lines). A user looking for their matches lands on account
  settings; a user looking for settings has no link at all.
- `/settings` exists, is linked from nowhere, mounts a second `<Navbar />` under the
  global one, and uses off-theme literal colors (`app/settings/page.tsx:26-30`).
- Fix (§3.1): Home · Matches · Teams · Stratbook · Scouting in the bar; Profile, Settings,
  Plan under the Clerk avatar menu. `/profile` splits into `/matches` (the list) and
  `/settings` (Steam, theme, plan).

### 2.3 Dead and mocked routes still ship

| Route | State | Evidence |
|---|---|---|
| `/coach` | broken | posts to `/api/chat/stream`; no such route under `app/api/` |
| `/matches/[id]` | mocked | "Mock fetching match details" (`page.tsx:34`); links to `/coach` |
| `/admin` | mocked | fetches `/api/admin/qdrant-quota` (absent) and falls back to fake numbers; the real admin page is `/settings/admin` |
| `/onboarding` | broken | fetches `/api/proxy/oauth/status`; no `app/api/proxy` |
| `/settings` | orphan | see 2.2 |

`proxy.ts` protects `/dashboard(.*)` (does not exist) and does not protect `/stratbook`,
`/scouting`, `/settings`, `/billing/success`; those pages fetch signed-out and render
empty states instead of redirecting (`app/stratbook/page.tsx:22-31`).

Fix: delete the four dead pages, add `/matches` (2.2) so the name is reused for something
real, and align the matcher with the real route list.

### 2.4 The debrief page is two products in one file

`app/analysis/[jobId]/page.tsx` is 3,501 lines with 263 literal hex colors (next worst
file has 80). Inside it:

- `CoachingPanel` (lines 772–1222) renders the structured `report_v2` cards *and* the
  legacy markdown report with its own tab bar (Personal Report / Notes, or Team Strategy
  / Coach Insights / Teammate Profiles / Notes), a hand-rolled markdown renderer, and an
  accordion. The legacy block is behind `<details>` but its tab bar still renders in the
  header whenever `isScribeFormat` is true, so the user sees tabs that switch content they
  cannot see until they open the disclosure.
- `MatchStatsPanel` (lines 1229–2506, ~1,300 lines) holds ten pieces of UI state:
  tab → utility sub-tab → breakdown tab, plus sort field, direction, team filter,
  list/grid, hovered player. Its active-tab color is `#eb5e28` (28 uses), an orange from
  no theme.
- `KillHeatmap` (299–770), `EconomyChart` (2506–2864), `RoundTimeline` (2864–2989) are
  each larger than any component in `components/analysis/`.
- Dead state: `viewerMode` / `replayView` (lines 2995–2996) and the dynamic `DemoViewer`
  import (line 14) have no consumer since the replay was quarantined to `/replay`.

Fix (§3.2): split into `components/debrief/*`, delete the legacy markdown path once
every cached report has `report_v2` (or keep it as one "Full text" drawer with no tabs),
collapse `MatchStatsPanel` to one tab level.

### 2.5 The finding deep link lands in the wrong place

`handleFindingRound` (`page.tsx:3018-3024`) sets the playback store's round, sets
`viewerMode("3d")` (unused, 2.4), and scrolls to `#replay`. The `#replay` section is the
static kill-position heatmap; the actual replay is a separate page. A user clicking
"R14" on a finding gets scrolled to a heatmap with the round filter applied and no
indication of what changed. Fix: scroll to `#rounds`, highlight row 14 in
`RoundTimeline`, and label the control "Show round 14".

### 2.6 Plan and quota vocabulary disagree

- `lib/flags.ts`: `free / basic / pro`, `aiCoaching: false` for `basic`, real Stripe
  price ids inline. Backend: `FREE / SOLO_PRO / TEAM`, `SOLO_PRO` has `FULL_COACHING`.
  `/billing` sells "Full AI coaching" on Solo Pro. Three sources, two of them wrong.
- `/billing` signed-out shows a "Current Plan" button on Free and the footer text "Test
  card: 4242 4242 4242 4242" to the public (seen in the deployed screenshot).
- Free tier copy says "2 demo uploads total"; the quota logic is monthly
  (`app/profile/page.tsx:213-219`, commit `d4df953`).

### 2.7 Landing page is not complete at rest

Both grids below the hero use `whileInView` with `hidden = { opacity: 0 }`
(`app/page.tsx:120-127`, `171-176`). Anything that does not scroll — a link preview,
a full-page screenshot, the e2e design-review capture — shows a blank band where the four
agents and the pipeline should be. At 390px the agent cards never appeared in the capture
at all. Fix: render visible by default and let motion be additive (`initial` only on the
hero, or `animate` with `useInView` and a visible fallback), per the "complete at rest"
rule.

### 2.8 Charts (dataviz pass)

- `components/analysis/MetricRadar.tsx`: a radar of six finding counts. Radar area
  misreads counts and ordering; the form for "compare magnitude across six categories"
  is a sorted horizontal bar or the category chips that `TeamView` already draws.
- Utility breakdown stack (`page.tsx:927-931`): Tailwind default hexes (`#3b82f6`,
  `#f59e0b`, `#ef4444`, `#9ca3af`, `#10b981`); red on incendiaries reads as an error
  state. Use one categorical order from the tokens and a 2px surface gap between segments.
- Side colors: tokens define `--color-ct` / `--color-t` (T is gold in the Khan theme) and
  the header uses them, but the heatmap and duel table hard-code blue vs red
  (`page.tsx:3427-3431`). The same team is gold in the timeline and red on the map.
- `KillHeatmap` draws on a canvas with no map underlay (spec §15 "2D demo viewer":
  bounding-box projection pending calibration). Until a radar image is under it, the
  dots do not tell the reader where anything happened; the section header promises
  "Where every kill happened on the map".

### 2.9 Quality floor

- Tab bars are `div`s of `button`s with no `role="tablist"` / `aria-selected`
  (`CoachingPanel`, `MatchStatsPanel`, team hub).
- Data labels at `text-[9px]`, `text-[10px]`, `text-[11px]` throughout the debrief and
  stat tables; 11px mono is the floor for anything a player has to read at a glance.
- `app/settings/page.tsx`, `app/matches/[id]`, `app/admin` ignore the token system
  entirely (CloudMotifBg with no `def.motifs` gate, literal navy/gold).
- Lint warnings are all unused imports/vars plus one `exhaustive-deps`; none block.

## 3. Target structure

### 3.1 Information architecture

```
Navbar:   [mark] Home · Matches · Teams · Stratbook · Scouting        [Upload] [avatar ▾]
                                                                        avatar menu: Profile · Settings · Plan
/                Command Center: upload hero, last 5 matches (all modes, badge per row), plan card
/matches         the list (from /profile) + filter chips: All · Personal · Team · Scouting
/analysis/[id]   debrief; header shows map · score · grade · MODE BADGE · date
/settings        Steam link, theme, plan & quota (from /profile)
/teams, /teams/[id], /stratbook, /scouting, /billing   unchanged
deleted:         /coach, /matches/[id] (mock), /admin, /onboarding, the global mode toggle
```

Every page still answers the three questions from `DESIGN_PLAN.md` §8 — where am I,
what happened, where next — but now the answer to "what happened" is on the match, not
in a preference.

### 3.2 Debrief page

Above the fold: grade tile, headline, the top three findings as `InsightCard`s, and a
"Show all N findings" control. Then, in order, collapsible sections: Rounds (timeline +
economy), Duels, Players, Kill positions. One "Full text report" drawer replaces the
legacy tab bar; Notes becomes a button in the header that opens a side panel (it
triggers a re-run, which deserves a confirm step).

Split `app/analysis/[jobId]/page.tsx` into `components/debrief/{CoachingPanel,
MatchStatsPanel, KillHeatmap, EconomyChart, RoundTimeline}.tsx` first — a pure move —
then simplify each. `page.tsx` keeps polling, status, and layout only.

## 4. Plan, in order

Superseded 2026-09-29 by `FRONTEND_REFACTOR_PLAN.md`, which groups every finding in
this document by root cause into seven workstreams. The original P-ids are kept there
in the "Closes" column so the evidence above still resolves:

| Id | Finding (short) | Now in |
|---|---|---|
| P0-1 | Test-card copy and free-tier wording on `/billing` | W0 |
| P0-2 | Delete `/coach`, `/matches/[id]`, `/admin`, `/onboarding` | W0 |
| P0-3 | Landing grids visible at rest | W3 (shell) |
| P0-4 | Finding deep link lands in the wrong place | W5 |
| P1-1 | Mode chosen at upload, badge on rows and header | W1 + W2 |
| P1-2 | Nav rename, `/profile` → `/matches`, `/settings` split | W3 |
| P1-3 | One plan vocabulary, `flags.ts` display-only | W1 |
| P2-1…P2-4 | Debrief split, restructure, chart pass, tokenization | W5 |

## 5. Skills

Used in this review (bundled with Claude Code, nothing to install):

- `artifact-design` — the page-quality fundamentals in §2.7, §2.9 and the copy rules.
- `dataviz` — form selection and the anti-pattern list behind §2.8.
- `code-review` / `simplify` — run on the diff of each P-row before merging.

Worth installing for the P1/P2 work (third-party; both were cited in `DESIGN_PLAN.md`
but neither is present in this environment — `~/.claude/skills` holds only the bundled
set and `plugins/` is empty):

```
/plugin marketplace add anthropics/skills        # then install example-skills
                                                 # → frontend-design, webapp-testing
npx skills@latest add emilkowalski/skills        # emil-design-eng, review-animations,
                                                 # improve-animations, find-animation-opportunities
```

`webapp-testing` drives a local browser for signed-in screenshots — the missing
verification in §0 — once a `.env.local` with Clerk dev keys exists. `review-animations`
audits the motion budget in `DESIGN_PLAN.md` §8 mechanically.

Project skill added in this review: `.claude/skills/demosage-frontend/SKILL.md` carries
the token rules, motion rules, and this review's checklist so any future session applies
them without re-reading three planning documents.

## 6. Gap analysis — themes and coaching mode (2026-09-29, `demosage-frontend` skill)

Run against the skill's non-negotiables before building the two requested features:
a three-theme switcher (CS2 default, CS:GO, Great Khan nod) and a coaching mode that is
part of the upload workflow instead of a global toggle.

### 6.1 Themes — what exists

- Three palettes ship in `app/globals.css` (`khan` default, `purple-void`, `tactical`),
  registered in `lib/theme-config.ts` with a per-theme heading font and a `motifs` flag.
  `lib/themes.ts` applies the theme app-wide through `useSyncExternalStore`, and
  `layout.tsx` runs a pre-paint bootstrap so a saved theme never flashes.
- The mechanism is sound. The gaps are in the content and in where it is reachable.

### 6.2 Themes — gaps

| # | Gap | Evidence | Rule broken |
|---|---|---|---|
| T1 | The switcher is only mounted on `/profile`, below the fold, under a heading that says "Interface Theme". Nothing in the navbar or avatar menu reaches it. | `ThemeSwitcher` has one call site (`app/profile/page.tsx:544`) | Page rule: "where next" — a preference nobody can find is not a feature |
| T2 | No CS2 or CS:GO theme exists. The two non-Khan palettes are generic (violet, green). Neither carries any game artwork; `public/` holds only ten training thumbnails and Next.js boilerplate SVGs. | `THEMES` in `lib/theme-config.ts`; `ls public` | User brief: initial theme and artwork "mainly from CS2 and CS:GO" |
| T3 | The default is `khan`, so the Mongol identity is the first impression rather than the nod. Changing the default changes `DEFAULT_THEME`, the bootstrap script early-return, and the assumption in `globals.css` that `:root` is Khan. | `DEFAULT_THEME = "khan"`; `:root` block is the Khan palette | Brief: Khan is the third option |
| T4 | The Khan identity leaks outside the theme. `SoyomboProgress` is the only waiting-screen visual; `UploadModal` passes literal `#C9A227` / `#2D7DD2` into `SoyomboIcon`; every page imports `CloudMotifBg` / `UlziiBorder` from `patterns/mongolian.tsx`; the landing page names "The Great Khan" and "Khan's Library" as product features. | 13 files import from `patterns/mongolian`; 26 Khan/Scribe/Scout mentions in the debrief, 21 in admin settings | Non-negotiable 1 (literal colors) and the `motifs` contract in DESIGN_PLAN §7: a non-motif theme still shows the Soyombo on the one screen users stare at |
| T5 | Gold means two things. The tokens say `--color-accent-secondary` is "rank or achievement", but `UploadModal` and the navbar use it to mean "team mode". A CS2 palette will want a different secondary (orange), which makes the mode colour code silently change meaning per theme. | `UploadModal.tsx` `accentVar`; `Navbar` `modeButton` | Non-negotiable 1 (gold = rank) |
| T6 | Side colours are theme-dependent. Khan sets `--color-ct` to the brand blue and `--color-t` to brand gold, the other two use different CT/T pairs. Charts and killfeed change side colours when the theme changes, which the `dataviz` skill forbids (colour follows the entity). | `globals.css` lines 34–35 vs 80–81 and 120–121 | Skill checklist: side colours from tokens, fixed |
| T7 | `ThemeSwitcher` swatches and active borders use `t.accent`, a literal hex from the registry, with string-concatenated alpha. Fine for a swatch, but the active-state ring and background should use the current theme's tokens or a neutral. | `components/ThemeSwitcher.tsx` | Non-negotiable 1 |
| T8 | 263 literal hex colours remain in the debrief page alone. Any theme, CS2 included, renders the report in Khan blue and gold regardless of selection. | `grep -cE '#[0-9A-Fa-f]{6}' app/analysis/[jobId]/page.tsx` | Non-negotiable 1; P2-4 in §4 |
| T9 | No theme-aware screenshot exists. `e2e/debrief-shot.spec.ts` captures one theme, and the landing capture is blank below the fold (§2.7). | `e2e/*.spec.ts` | Checklist: full-page shot at 1440 and 390 in every kept theme |

### 6.3 Coaching mode — what exists

- The server already has the right model. `derive_mode` in `agents/scribe/modes.py` picks
  `OPPOSITION_RESEARCH` if `is_recon`, `TEAM_ANALYSIS` if the match has a `team_id`,
  otherwise `PERSONAL_IMPROVEMENT`. The presign request carries `team_id` and `is_recon`,
  the upload route forwards both, and `report_v2.mode` comes back on the coaching payload.
- So the mode **is** already a property of the match. The frontend hides that fact.

### 6.4 Coaching mode — gaps

| # | Gap | Evidence | Rule broken |
|---|---|---|---|
| M1 | The navbar toggle ("Individual" / "Team") is a global preference stored in `localStorage.coaching_mode` and broadcast by a `CustomEvent`. It is read in three places (`Navbar`, `app/page.tsx`, the debrief `CoachingPanel`) and none of them consult the match. | `grep coaching_mode` → 3 readers | Non-negotiable 7 |
| M2 | The toggle does not change what the server does. Uploading from the navbar with "Team" selected still sends no `team_id`, so the backend produces a personal report while the UI labels the upload "Team mode". The only true team path is the Team Hub upload button, which passes `teamId`. | `Navbar.tsx:263` passes `defaultMode` only; `UploadZone` sends `team_id: teamId` | Data flow: the client claims a mode the server never received |
| M3 | On the debrief, `CoachingPanel` reads the global toggle to decide whether to render the individual or team tab set, overriding `report_v2.mode`. Flip the toggle and a finished personal analysis re-renders as a team report with empty sections. | `app/analysis/[jobId]/page.tsx:789–812` | §2.1 |
| M4 | The upload modal copy points users at the navbar ("Switch modes with the toggle in the navbar") instead of offering the choice. Scouting (`is_recon`) is a checkbox that only appears when `defaultMode === "team"`, so a user who wants to scout must first discover the toggle, then the checkbox. | `UploadModal.tsx`; `UploadZone.tsx:414` | Page rule: one primary action, choices where they apply |
| M5 | Vocabulary is split three ways: navbar says Individual / Team, the server says PERSONAL_IMPROVEMENT / TEAM_ANALYSIS / OPPOSITION_RESEARCH, the pricing page says "Full AI coaching" / "Team analysis & opposition scouting", and the Scouting page is a separate route that filters on `is_recon`. | `Navbar`, `lib/api/client.ts:55`, `app/billing`, `app/scouting` | Copy rule: name things by what the player controls |
| M6 | Match rows expose `is_recon` but not the mode, so lists cannot badge a row as Personal / Team / Scouting without recomputing the server rule client-side. `/api/analyses` needs a `mode` field (refactor plan §3.6). | `api/routes/analyses.py` returns `is_recon` only | Non-negotiable 5 (server shapes, client renders) |
| M7 | Entitlement is not visible at the moment of choice. Team and Scouting modes need `TEAM_ANALYSIS` / `TEAM_SCOUTING`; the free tier learns this only after upload, via the redacted report. The modal has no plan-aware state for the two locked options. | `services/billing/entitlements.py`; `UploadModal` has no plan input | Non-negotiable 6: render the server gating shape, here as a locked option with the tier named |
| M8 | Team mode has a hidden prerequisite: a `team_id`. A user with no team who picks Team has nowhere to go. The modal must either pick a team or send them to create one. | `presign.py:60–70` rejects non-members | Page rule: empty states name the next action |

### 6.5 How mode bakes into the workflow (target)

One decision, made once, at upload, never again:

1. **Upload modal step 1: "Who is this analysis for?"** Three cards, always visible:
   *Coach me* (personal), *Coach my team* (team, requires picking one of the user's teams,
   or a "Create a team" link if none), *Scout an opponent* (recon). Locked cards show the
   tier that unlocks them and open the upgrade modal; they never disappear.
2. **Step 2: the drop zone.** The chosen mode is a chip in the modal header. The request
   sends `team_id` and `is_recon` exactly as today; no new backend contract is needed for
   the choice itself.
3. **Server owns the label.** `/api/analyses` and `/api/jobs/{id}` return `mode`; every
   list row and the debrief header show a Personal / Team / Scouting badge from that
   field. `CoachingPanel` picks its tab set from `report_v2.mode`.
4. **Delete** the navbar toggle, `localStorage.coaching_mode`, the `coachingModeChange`
   event, and the `defaultMode` prop. The Team Hub upload button pre-selects *Coach my
   team* with its team; the Scouting page button pre-selects *Scout an opponent*.
5. **Vocabulary**: Personal / Team / Scouting everywhere on the client, mapped once from
   the server enum in `lib/api/client.ts`.

### 6.6 Order of work

Mode first, then themes: the mode change deletes code and reshapes the upload modal
that the theme work restyles. The step list that used to live here is now
`FRONTEND_REFACTOR_PLAN.md` §3 (M-ids → B1, W1, W2; T-ids → W4, W5, W6).

Artwork note: CS2 and CS:GO imagery is Valve's. Use palette, typography and original
motifs (radar rings, bomb-site letters, buy-menu grid, the CS:GO orange and the CS2
blue-grey), not ripped logos or map images, so the themes are safe to ship.

## 7. Signed-in capture findings (2026-09-29)

The gap in §0 is closed: `e2e/signed-in-shots.spec.ts` signs up a fresh Clerk test user
against the deployed app (dev-instance `+clerk_test` email, code 424242, keys from the
gitignored `.env.e2e`) and captures every signed-in route at 1440 and 390. Run:

```
cd frontend && npx playwright test --project=shots --project=shots-mobile
# add --no-deps to reuse playwright/.clerk/user.json instead of signing up again
```

Output: `test-results/shots/{shots,shots-mobile}/<route>.png`, plus a per-route log line
with HTTP status, final URL, horizontal-scroll flag and uncaught page errors. The debrief
itself still needs a finished match; `upload.spec.ts` produces one from a local `.dem`.

What the captures showed, worst first:

| # | Finding | Evidence | Fix |
|---|---|---|---|
| S1 | **Any signed-in user can read and write the coaching prompts, model and temperature.** `/settings/admin` rendered the full editor with a Save button for a free-tier user created seconds earlier. The Next.js route only checks for a session; the FastAPI route only checks the shared secret. | `shots/settings-admin.png`; `app/api/admin/configs/route.ts` (`auth()` → `userId` only); `api/routes/admin.py` (no role check) | Check `publicMetadata.role === "admin"` in the server route (both verbs) and redirect non-admins from the page. Same for `/api/admin/provision`. Do this before anything else in this document. |
| S2 | `/admin` renders a mocked dashboard ("12,500 vectors, 450 MB, HEALTHY") to the same user. | `shots/admin.png` | Delete (P0-2). |
| S3 | Mobile navbar overflows at 390px: the Individual / Team toggle is cut off ("Tea") on every page, and the user-menu button sits outside the viewport (Playwright could not click it without `force`). | `shots-mobile/command-center.png`, Playwright click log | Removing the toggle (P1-1) fixes this; until then collapse it into the hamburger. |
| S4 | Stratbook has horizontal page scroll at 390px, and its header collides with the title input and the two buttons; the page title is clipped under the navbar at both widths. `/coach` clips its heading the same way. | `shots-mobile/stratbook.png` (`hscroll=YES`), `shots/coach.png` | Page top padding equal to the navbar height on both routes; stack the header on mobile. |
| S5 | The Clerk user menu is the unthemed white default with a "Development mode" badge, on the production URL. | `shots/avatar-menu.png` | Pass a dark `appearance` to `ClerkProvider`; move production to a Clerk production instance. |
| S6 | `/settings` is a single "Weapon Skins Plugin" toggle. The theme picker, Steam link and plan live on `/profile` instead, under the match list. | `shots/settings.png`, `shots/profile.png` | P1-2 split: preferences on `/settings`, matches on `/matches`. |
| S7 | The upload modal states the mode ("Individual mode — Switch modes with the toggle in the navbar") rather than asking for it; on mobile the chip wraps to two lines. | `shots/upload-modal.png`, `shots-mobile/upload-modal.png` | §6.5. |
| S8 | Empty states are good (Teams, Scouting, Recent analyses all name the next action) but the Scouting one tells the user to "tick the recon checkbox on the upload form", a control that is hidden unless Team mode is on. | `shots/scouting.png` | Resolved by §6.5. |
| S9 | Profile shows "PLAYER" as the display name and "Loading analyses..." for over two seconds on a user with zero matches; the mobile order puts the match list last, below the theme picker. | `shots/profile.png`, `shots-mobile/profile.png` | Use the Clerk name or the email local part; render the empty state immediately when the query returns `[]`; main content first on mobile. |
| S10 | "Test card: 4242 4242 4242 4242" is on the signed-in pricing page too; the free card shows "2 demo uploads total" while the profile says "Monthly Analyses 0/2, resets on the 1st". | `shots/billing.png`, `shots/profile.png` | P0-1. |
| S11 | Onboarding promises "no manual uploads required" via Steam and FACEIT linking; only the FACEIT crawler exists, and the page is not linked from anywhere. | `shots/onboarding.png` | Delete (P0-2) or reword when the Steam fetcher ships. |
| S12 | No page threw an uncaught error; every route returned 200. | run log | — |

### 7.1 Team Hub (`e2e/team-hub-shots.spec.ts`)

Creates a team through the UI for the saved e2e user, then captures the list, the hub
overview, the invite box, the team-mode upload modal, the Stratbook / AI Coach / Settings
tabs and the training page, at 1440 and 390. Run:

```
cd frontend && npx playwright test --project=team-shots --project=team-shots-mobile --no-deps
```

| # | Finding | Evidence | Fix |
|---|---|---|---|
| H1 | **The Team Hub's own "Upload a demo" opens the modal labelled "Individual mode — Coaching focuses on your own play", with no recon option.** The hub passes `teamId` but not `defaultMode`, so the one path that really sends a `team_id` tells the user it is personal. This is M2 from §6.4 seen from the other side. | `team-shots/team-upload-modal.png`; `app/teams/[teamId]/page.tsx:1376` | §6.5: the modal asks, the caller only pre-selects. |
| H2 | Hub tabs overflow at 390px: "AI Coach" wraps to two lines and "Settings" runs off the right edge. | `team-shots-mobile/team-overview.png` | Scrollable tab row or icon-only tabs under 480px; `role="tablist"` while there. |
| H3 | Training page header at 390px stacks the subtitle beside the Back button in a 300px-tall column. | `team-shots-mobile/team-training.png` | Stack header rows on mobile; the subtitle can drop. |
| H4 | "+ Invite a team member" throws an uncaught `NotAllowedError` from `navigator.clipboard.writeText` when clipboard permission is absent, while the UI still shows "Copied to clipboard!". | run log (`errors=1` in both projects) | Await the promise in a try/catch; on failure show the code with a select-all and say "Copy" instead of claiming success. |
| H5 | Team Settings shows a "Deterministic Devil Fruit" One Piece card ("Zoan class — Hito Hito no Mi") as the team identity, plus "Password" and "Subscription" sections for a team. | `team-shots/team-tab-settings.png` | Keep the hashed fallback icon, drop the lore card; team password has no backing feature (`grep -ri password api/routes/teams.py` is empty); subscription belongs to the user's plan page. |
| H6 | "Team strats · live · syncs every 15s" is a hand-rolled poll on the overview. | `team-shots/team-overview.png`; `fetchStrategies` in the hub page | TanStack Query `refetchInterval` (non-negotiable 5), and only while the tab is visible. |
| H7 | The AI Coach tab is a second chat surface ("Great Khan Strategy Coach") with sample prompts about Vitality and Team Spirit; it lists the user's personal matches under "Individual matches (1)" next to "Team scrims (0)". This one has a live endpoint (`/api/teams/[teamId]/strategies/chat`), unlike `/coach`. | `team-shots/team-tab-ai-coach.png` | Keep as the only chat; name it by what it does ("Ask about this team's demos and strats"). |
| H8 | Free-tier user sees "Spin up a server", "Open training modes" and the whole training catalogue with no plan hint; the paywall appears only on click. | `team-shots/team-overview.png`, `team-training.png` | Server-driven `locked` state on the buttons (non-negotiable 6), like the coaching preview. |
| H9 | Empty states on the hub are good: every card names its next action. The list → hub → tabs structure is the clearest navigation in the app. | `team-shots/team-overview.png` | Reuse this shape for `/matches`. |

### 7.2 Debrief (`e2e/upload.spec.ts` → `e2e/debrief-shot.spec.ts`)

`upload.spec.ts` pushed the 339 MB Anubis demo through the deployed pipeline as the e2e
user: gzip in the browser, chunked upload, Go parse, then coaching. Parse was visible at
about two minutes; the coaching card kept its spinner for several minutes more (the spec
now waits for it). `debrief-shot.spec.ts` then captured the finished page under the
`shots` and `shots-mobile` projects:

```
cd frontend
$env:E2E_MATCH_URL = "https://<host>/analysis/<match_id>"
npx playwright test --project=shots --project=shots-mobile --no-deps e2e/debrief-shot.spec.ts
```

| # | Finding | Evidence | Fix |
|---|---|---|---|
| D1 | **Personal mode without a linked Steam ID coaches a stranger.** The report says "Your Steam ID was not linked, so this report is based on general team patterns and the actions of specific, unidentified players", then its one visible finding names a raw Steam64 ID as "one player on your team". Score 48, grade D, for a player the user may not be. The Command Center banner warned, but the upload still went through in personal mode. | `shots/debrief-full.png` coaching card | In the §6.5 picker, *Coach me* requires a linked Steam ID (inline "Sign in through Steam" on the card, or fall back to *Coach my team*). Never produce a personal report with `uploader_steam_id` empty. |
| D2 | The page can render with everything below the timeline invisible. The pipeline capture (taken while coaching was loading) shows a 2800 px page with 2300 px of empty space; the later capture shows all sections. Same `whileInView` pattern as the landing page (§2.7). | `test-results/debrief-full.png` vs `shots/debrief-full.png` | P0-3 for the debrief sections too: visible at rest. |
| D3 | Horizontal page scroll at 390px; the section tab strip (Report · Rounds · Momentum · Duels · Replay · Players) is cut off after "Players". | `shots-mobile/debrief-full.png` (`hscroll=YES`) | Scrollable tab strip with `overflow-x: auto` on the strip only, `role="tablist"`. |
| D4 | Header says "Team A 10 – 12 Team B" although the parser now emits rosters and clan names (commit 00be28b). The "D" chip next to the score is the grade with no label. | `shots/debrief-full.png` header | Use clan names when present, else the top-fragger's name; label the grade ("Grade D · 48"). |
| D5 | Economy Trend draws two overlapping filled areas; the fills hide each other around rounds 4 to 12 and 13 to 22. | `shots/debrief-full.png` | Two 2px lines, no fill (dataviz: area is for a single series); keep the halftime rule. |
| D6 | Kill positions: duplicated heading ("Kill positions" card + "Kill Positions" panel), 142 markers stacked into an unreadable cluster, and the round filter that would fix it lives in a different card ("Click round to filter"). | `shots/debrief-full.png` | One heading; default the map to the selected round or the last five; put the round filter above the charts it scopes (dataviz: one filter row). |
| D7 | Duel explorer is a nested scroll region inside the page; on desktop it clips at round 2 with its own scrollbar. | `shots/debrief-full.png` | Paginate by round (previous / next, matching the timeline selection) instead of an inner scroll. |
| D8 | Mobile page is 9,353 px tall at 390 px wide (about 24 screens). The tab strip implies sections but everything renders in one column. | `shots-mobile/debrief-full.png` | Make the tabs real on mobile (one section at a time), or collapse the secondary sections behind their headings. |
| D9 | What works: the coaching card leads, the locked-insights teaser is honest and server-shaped, the round timeline reads well at both widths, no page errors, all numbers are mono. | both captures | Keep. |
| D10 | `upload.spec.ts` treated the "Match debrief" header as "coaching settled" and screenshotted the spinner. | `test-results/debrief-full.png` | Fixed in this pass: the spec now waits for the "studying your demo" text to disappear. |
