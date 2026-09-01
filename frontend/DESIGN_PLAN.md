# DemoSage Frontend Design Plan

Produced with Anthropic's `frontend-design` skill (the most widely adopted design skill for
Claude Code, ~797k installs). The skill's method: ground the design in the subject, define a
compact token system (color / type / layout / signature), critique the plan against generic
AI defaults before building, and hold a quality floor (responsive, keyboard focus, reduced
motion) without announcing it.

---

## 1. The subject, pinned

- **Product:** DemoSage — upload a CS2 `.dem`, LangGraph agents ("The Scout", "The Tactician",
  "The Great Khan") return round-by-round coaching.
- **Audience:** competitive CS2 players and small teams — people who already read kill feeds,
  economy tables, and radar maps fluently. They are not intimidated by density; they are
  intimidated by fluff.
- **The page's single job:** get a demo uploaded, then make the coaching report feel like a
  debrief from a commander — authoritative, specific, worth acting on.
- **Identity that already exists and must win:** the Mongol Empire direction is *pinned by the
  brief* — Soyombo logo mark, Ulzii border, "Great Khan" agent naming, "Eternal Blue Sky +
  gold" palette in `globals.css`, Cinzel display face. Per the skill: where the brief pins a
  direction, follow it exactly. The distinctive material is already here; the problem is that
  half the app ignores it.

## 2. Diagnosis of the current state

The frontend is two design systems fighting:

| Camp | Where | Look |
|---|---|---|
| **Great Khan tokens** | `globals.css` (full token system), `Navbar`, `profile`, `coach`, `onboarding`, `admin`, `matches/[id]`, `teams/[teamId]` (235 token usages, 7 files) | Deep navy, steppe blue `#2D7DD2`, gold `#C9A227`, Cinzel headings |
| **Generic dark SaaS** | `app/page.tsx` (the landing page!), `analysis/[jobId]`, `stratbook`, `teams`, `Viewer3D`, `UploadZone`, planning/strategy components (87 hard-coded values, 13 files) | `#0A0A0A`, `neutral-900`, white pill buttons, gray gradient text — the exact "near-black + system grays" template the skill calls out as AI-default |

Concrete defects:

1. **The front door is off-brand.** `app/page.tsx` renders its own fixed header *and* the
   global `<Navbar />` mounts from `layout.tsx` — two overlapping fixed headers — and its
   entire visual language (`#0A0A0A`, neutral grays, white pills) belongs to no theme in
   `globals.css`. The theme switcher can't touch it.
2. **Tokens exist but are bypassed.** Even token-camp files (e.g. `Navbar.tsx`) inline the hex
   values (`#C9A227`, `#2D7DD2`, `#1E3A5F`) instead of `var(--color-…)`, so the `purple-void`
   and `tactical` themes silently break on those surfaces.
3. **Motion has no floor.** `CloudMotifBg` runs 4 layers of infinite animation (blur-120px
   blobs, drifting hex grid, 15 spark embers) with no `prefers-reduced-motion` handling and
   real GPU cost on the page where users read dense data.
4. **Copy is system-voiced.** "Deploy Match Intelligence", "System Online", "executive
   report" — the skill's writing rule: name things by what people control ("Upload a demo",
   "Your last match"), active plain verbs, no selling.

## 3. Token system (the plan of record)

Keep the Great Khan system; sharpen it; make it the *only* system.

### Color — named, 6 values (already in `globals.css`, now canonical)

| Token | Hex | Name / justification |
|---|---|---|
| `--color-bg-primary` | `#050C15` | **Night steppe** — near-black with a blue cast, not neutral black |
| `--color-accent-primary` | `#2D7DD2` | **Eternal Blue Sky** (Tengri) — the empire's own color, and CT-side blue |
| `--color-accent-secondary` | `#C9A227` | **Khan's gold** — rank, authority, "Pro" tier |
| `--color-text-primary` | `#F0F4FF` | Moonlit white |
| `--color-danger` | `#FF4D6D` | Kill-feed red — deaths, failed rounds |
| `--color-success` | `#22D3A0` | Round-won jade |

Rule: **gold is rank, blue is action, red is death.** Gold appears only where hierarchy or
achievement is being conferred (logo, Pro badge, "strongest area", MVP). Buttons and links are
blue. Red is reserved for kill events / errors — never decoration. This encoding is structure,
not decoration (skill: "structural devices should encode something true about the content").

### Type — 3 roles (already loaded in `layout.tsx`, now used consistently)

- **Display: Cinzel** — the imperial serif. Used *with restraint*: page titles, round
  banners, the report's section headings. Never body text, never buttons.
- **Body: Inter** — quiet delivery vehicle. The skill warns Inter is the default default; it
  earns its place here precisely because Cinzel and JetBrains Mono carry all the personality
  and the data-dense body needs to disappear.
- **Data: JetBrains Mono** — all numbers: economy values, K/D, timers, tick counts, round
  numbers. In a stats product the mono face *is* the utility face, and applying it to every
  numeral is what makes tables and kill feeds read as telemetry rather than prose.

### Layout concept

The report reads as a **military debrief scroll**: one column of authority, data flanking it.

```
Landing (logged out)                 Analysis report
┌──────────────────────────┐         ┌────────────────────────────┐
│  Navbar (global, only)   │         │  Navbar (global, only)     │
├──────────────────────────┤         ├────────────────────────────┤
│   ᠳ Soyombo watermark    │         │ MAP · SCORE · DATE   (mono)│
│  CINZEL DECLARATION      │         │ ═══ Ulzii border ═════════ │
│  one line of body copy   │         │ ┌────────┐ ┌─────────────┐ │
│  [ Upload a demo ]       │         │ │ round  │ │  Great Khan │ │
│  ═══ Ulzii border ═══    │         │ │ rail   │ │  verdict    │ │
│  4 agent cards (2×2)     │         │ │ 1…24   │ │  (Cinzel hd)│ │
│  pipeline as a timeline  │         │ │ W/L    │ │  kill feed  │ │
└──────────────────────────┘         │ │ colored│ │  economy    │ │
                                     │ └────────┘ └─────────────┘ │
                                     └────────────────────────────┘
```

- The **round rail** (left, sticky) is a vertical strip of 24 numbered cells colored by
  win/loss — numbering is justified here because rounds genuinely are a sequence.
- The Ulzii border is the *only* horizontal divider used app-wide; hairline `border-white/5`
  dividers are removed. One structural motif, used consistently, beats five generic ones.

### Signature element

**The Soyombo-as-progress.** During parse/analysis (the job users actually wait on), the
Soyombo mark draws itself element by element — flame → sun → moon → bars — each element
lighting up as a pipeline stage completes (Scout parse → RAG retrieval → Tactician analysis →
Great Khan synthesis). The waiting screen is the single moment every user stares at the app;
that is where the one memorable thing belongs. Everywhere else stays quiet and disciplined.

The existing `CloudMotifBg` spark/blob spectacle is *retired* from data pages and kept (in a
reduced, `prefers-reduced-motion`-gated form) only behind the logged-out hero.

## 4. Critique against generic defaults (skill step)

- *Near-black + single acid accent* — the current landing page is exactly this default. The
  fix is not a new invention; it's enforcing the already-distinctive Khan system on it.
- *Dark navy + blue + gold* could itself be a template ("crypto dashboard"). What keeps it
  specific: the named cultural anchors (Soyombo, Ulzii, Tengri blue), Cinzel as display, and
  the gold-is-rank rule. No gradient text, no glassmorphism cards stacked on glow blobs.
- *Numbered markers* — kept only on the round rail and pipeline timeline, where order is
  real information. Removed from the feature grid.
- **The one aesthetic risk:** Cinzel — a Roman inscriptional serif — as the voice of a
  Mongol-empire esports tool is historically wrong-on-purpose and visually imperial; it is
  the choice a template would never make. Spend the boldness there and in the
  Soyombo-progress; keep everything else quiet.

## 5. Copy direction (skill's writing rules applied)

- Buttons say what happens: **"Upload a demo"**, not "Deploy Match Intelligence" or
  "Get Started". The action keeps its name: upload → "Uploading…" → "Demo uploaded".
- Status is user-side: "Analyzing round 14 of 24", not "System Online".
- Agent names (Scout, Tactician, Great Khan) stay — they're the product's vocabulary — but
  each is introduced once with a plain-terms role line ("The Scout — reads every tick of
  your demo").
- Errors state cause and next step: "This file isn't a CS2 demo (.dem). Export it from your
  match history and try again." No apologies, no vagueness.
- Empty states invite the single action: profile with no analyses → "No matches analyzed
  yet. Upload your first demo."

## 6. Implementation plan (ordered)

### Phase 1 — one system (the load-bearing fix)
1. **`app/page.tsx`:** delete the page-local header (Navbar already mounts globally);
   rebuild hero + feature grid + pipeline timeline on tokens, Cinzel display, Ulzii divider,
   Soyombo watermark. Remove gradient text and white pills.
2. **Tokenize the hard-coded 13 files:** replace `#0A0A0A`/`neutral-*`/`slate-*`/inline hex
   with `var(--color-…)` / the `.card`, `.btn-primary`, `.section-heading` utilities.
   `Navbar.tsx` first (it's on every page), then `analysis/[jobId]`, `UploadZone`,
   `stratbook`, `teams/*`, `Viewer3D` chrome.
3. **Type discipline:** `font-mono` on every numeric cell (economy, K/D, timers, scores);
   Cinzel only via `.section-heading`/`h1–h3`.

### Phase 2 — the signature & the report
4. Build **SoyomboProgress** (staged SVG stroke/fill reveal keyed to job status from
   `/api/jobs/[jobId]` polling) and use it as the analysis waiting state.
5. Restructure the report page to the **round rail + verdict column** layout; color rail
   cells by round winner; kill feed rows use red/jade encoding; economy numbers in mono.
6. Rewrite copy per §5 across landing, upload, analysis, empty states, errors.

### Phase 3 — quality floor (unannounced, non-negotiable)
7. `prefers-reduced-motion`: gate CloudMotifBg, framer-motion variants, and
   SoyomboProgress's decorative motion (progress state changes remain visible statically).
8. Visible `:focus-visible` ring (blue, 2px offset) on every interactive element; the
   upload zone fully keyboard-operable.
9. Responsive pass: round rail collapses to a horizontal scrubber under `md`; tables get
   `overflow-x-auto` wrappers; test at 375px.
10. Theme integrity: with zero hard-coded hexes left, verify `purple-void` and `tactical`
    render correctly everywhere or cut them (a broken theme switcher is worse than none).

### Verification
- `cd frontend && npm run lint && npx tsc --noEmit` after each phase.
- Screenshot review (skill: "a picture is worth 1000 tokens") of landing, upload, waiting,
  report at desktop + 375px, in all kept themes, with reduced motion on and off.

---

## 7. Component system v2 (implemented)

Built with Emil Kowalski's `emil-design-eng` + `animate` skills
([emilkowalski/skills](https://github.com/emilkowalski/skills)) layered on the
frontend-design plan above.

### Theme architecture — identity is now swappable

- `lib/theme-config.ts` — server-safe registry. Each theme declares palette (via
  `[data-theme]` CSS blocks in `globals.css`), its **display font**
  (`--font-heading`: Khan → Cinzel, Purple Void → Inter, Tactical → JetBrains Mono),
  and a `motifs` flag: whether the cultural identity layer (Soyombo mark, Ulzii
  divider, CloudMotifBg ambience) renders. The Great Khan theme is the only motif
  theme today; a future theme brings its own or none.
- `lib/themes.ts` — `useTheme()` hook (useSyncExternalStore over localStorage);
  any component reads `def.motifs` reactively. Theme switching now works app-wide,
  not just where ThemeSwitcher happens to be mounted, and an inline bootstrap
  script in `layout.tsx` applies the saved theme before first paint.
- Components never hard-code identity: Navbar/UploadModal render the Soyombo only
  when `def.motifs`, falling back to a neutral mark otherwise.

### Motion layer (Emil's rules, as tokens)

In `globals.css`: `--ease-out: cubic-bezier(0.23,1,0.32,1)`,
`--ease-in-out: cubic-bezier(0.77,0,0.175,1)`, `--ease-drawer`, durations
`--dur-press 140ms / --dur-fast 180ms / --dur-base 220ms / --dur-modal 240ms`.
House rules enforced by the primitives: transitions name exact properties (no
`transition-all`); UI under 300ms; never ease-in; entrances start ≥ scale(0.95)
never scale(0); pressables scale to 0.97 on `:active`; hover motion gated behind
`@media (hover:hover) and (pointer:fine)`; `prefers-reduced-motion` keeps fades,
drops movement, and stills all `ds-decorative-motion` layers.

### Primitives — `components/ui/`

| Primitive | Notes |
|---|---|
| `Button` | 4 variants × 3 sizes over `.ds-btn`; press feedback + focus ring built in |
| `Modal` | CSS-transition enter (240ms) / faster exit (160ms), interruptible, centered origin, Escape + scroll lock + focus restore, aria-modal |
| `Progress` | fill animates `scaleX` (GPU), never `width`; proper progressbar ARIA |
| `Spinner` | 650ms rotation — faster spin reads as faster app |
| `Card` | `.card` / `.card-elevated` wrapper |

### Rebuilt on the system

Navbar, UploadZone (upload logic untouched), UploadModal, ThemeSwitcher,
ServerControlPanel, TeamIcon, landing page (`app/page.tsx` — duplicate header
removed, token-driven, 300ms/50ms-stagger entrances honoring reduced motion),
AddStrategyModal, CS2PlanningBoard, Viewer3D chrome. Also fixed: the
`--font-mono` self-reference in the old globals.css that silently disabled
JetBrains Mono everywhere.

---

## 8. Flow refactor (v3) — one journey, not islands

Planned against Emil Kowalski's animation decision framework (frequency gates,
orchestrated moments over scattered effects, spatial consistency) + the
frontend-design skill (hero as thesis, one signature element, quality floor).

### The journey

```
Landing (thesis) ──sign up──▶ COMMAND CENTER (logged-in home)
                                │  upload hero + recent analyses + mode-aware
                                │  quick routes (Teams/Stratbook/Scouting)
                                ▼ upload
                              ANALYSIS
                                │  waiting = SoyomboProgress (THE signature
                                │  moment: Parse→Compare→Analyze→Report,
                                │  the mark assembles stage by stage)
                                ▼ ready
                                header (map · score · grade) + section nav:
                                Report (ModeSwitchedReport) · Replay (2D/3D)
                                · Rounds — findings deep-link onward:
                                recon → /scouting, team → /stratbook
```

Every page answers: where am I, what happened, where do I go next.
Analyses list rows carry grade + status and lead to the analysis; empty
states point at the one action that fills them.

### Motion budget (Emil's frequency gate, applied)

| Surface | Frequency | Motion |
|---|---|---|
| Navbar links, mode toggle | 100+/day | none beyond press feedback |
| Page enter | tens/day | one 300ms fade-up, 50ms stagger, ease-out token — the SAME everywhere (spatial consistency); reduced-motion → fade only |
| Upload dropzone | occasional | existing calm rings; drag feedback only |
| **Processing screen** | rare + long attention | the delight budget lives HERE: SoyomboProgress — flame→sun→moon→bars light up as pipeline stages complete; current stage pulses |
| Report reveal | occasional | staggered card entrance once, on data arrival |

### Navbar as the flow's spine

Left: mark + wordmark → home. Center (md+): Dashboard · Analyses · Teams ·
Stratbook · Scouting with active states. Right: Upload as the primary CTA
button (the product's one verb, visible everywhere), mode toggle, plan chip,
avatar. Mobile menu keeps parity.
