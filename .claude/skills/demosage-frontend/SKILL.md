---
name: demosage-frontend
description: Use when building, reviewing, or refactoring anything under frontend/ in DemoSage (Next.js 15 + Tailwind v4). Encodes the design system (tokens, fonts, motion budget, ui primitives), the page rules every route must satisfy, and the UX-review checklist from frontend/UX_REVIEW.md. Triggers on "frontend", "page", "component", "navbar", "debrief", "analysis page", "design", "UX", "theme", "chart", "Tailwind", "tsx".
---

# DemoSage frontend

Source of truth, in precedence order: the user's words → `frontend/FRONTEND_REFACTOR_PLAN.md`
(target IA, upload flow, theme slots, shell, debrief; §6 is the page map the rewrite was
built from) → `app/globals.css` (the tokens as shipped) → `frontend/UX_REVIEW.md`
(the pre-rewrite evidence) → this file. `frontend/DESIGN_PLAN.md` predates the rewrite;
where it disagrees with `globals.css`, the CSS wins.

The frontend was rewritten from scratch on 2026-10-01 (branch `frontend-rewrite`). Every
page, primitive and theme file is new; only `app/api/**`, `lib/api/client.ts`,
`lib/stores/playback.ts`, `components/minimap/*` and the e2e suites carried over.

## Non-negotiables

1. **Colors come from tokens.** `var(--color-…)` from `app/globals.css`, never a literal
   hex, never Tailwind palette classes (`slate-*`, `neutral-*`, `blue-500`). Three themes
   switch on `[data-theme]` (`:root` = CS2, `csgo`, `khan`); a literal breaks two of
   them. Side colors are `--color-ct` / `--color-t` and never change per theme.
   `--color-accent` means action; `--color-rank` (gold) means rank, achievement or the
   Team tier; `--color-focus` is links and focus rings; `--color-good` / `--color-warning`
   / `--color-danger` are status only (danger = death or error, never decoration).
   Allowed literals: canvas fallbacks in `components/minimap`, theme swatches in
   `lib/theme/config.ts`, and the Clerk `appearance.variables` in `app/layout.tsx`.
2. **Fonts by role.** `var(--font-heading)` for page titles and section headings only
   (the `h1`–`h4` rule in `globals.css` applies it), `var(--font-body)` for prose, and
   the `num` class (`--font-mono`, tabular) for every number: economy, K/D, ticks,
   rounds, timers, ids. Data labels never below 11px; `eyebrow` is the small-caps label.
3. **Primitives first.** `components/ui` (one barrel, `@/components/ui`): `Button`
   (`asChild` for links, `loading`), `Card`/`CardHeader`, `Badge`/`ModeBadge`/`GradeChip`,
   `Modal` (Radix), `Tabs`, `PageHeader`, `Field` (Input/Select/Textarea/Label/Switch),
   `Feedback` (Skeleton, EmptyState, Notice, Stat, ProgressBar), `Toast`. CSS utilities:
   `surface`, `surface-2`, `hairline`, `container-app`, `enter`, `link`. No shadcn, no new
   UI library. Errors go through `toast()`, never `alert()`.
4. **Motion budget.** Transitions name properties (no `transition-all`), under 300ms,
   `--ease-out`, never ease-in. One page-enter fade-up via the `enter` class; the only
   orchestrated moment is `ProgressMark` on the waiting screen (three identity marks,
   one per theme). Content must be visible at rest — never leave sections at
   `opacity: 0` waiting for `whileInView`. Respect `prefers-reduced-motion`.
5. **Data flow.** Server routes under `app/api/*` attach auth and the shared secret;
   components never call FastAPI directly. New reads go through TanStack Query hooks in
   `lib/api/hooks.ts`, not hand-rolled `useEffect` poll loops. Playback tick state lives in
   the Zustand store (`lib/stores/playback.ts`), never in React state.
6. **Gating is server-driven.** Components render the shape the server sent (full,
   redacted, teaser). No client-side hiding of paid content.
7. **Mode belongs to the match**, not to a global preference. The upload modal's mode
   picker sends `team_id` / `is_recon`; the server derives `mode` and returns it on every
   match row. There is no global toggle, no `localStorage.coaching_mode`, no window
   event bus. Do not reintroduce any of them.
8. **No `setState` inside `useEffect`.** The lint rule `react-hooks/set-state-in-effect`
   is an error here. Derive state during render, key a component to remount it (see
   `UploadModal`), or subscribe with `useSyncExternalStore` (see `Toast`, `useTheme`).

## Page rules

Every route answers: where am I (heading + active nav), what happened (the data, summary
before detail), where next (one primary action, empty states that name it). Copy is
written from the player's side: "Upload a demo", "Show round 14", not "Deploy" or
"System online". Errors say what went wrong and what to do.

## Review checklist

Run this on any frontend diff before calling it done:

- [ ] `cd frontend && npm run lint && npx tsc --noEmit` clean (delete `.next` if `tsc`
      reports routes that no longer exist).
- [ ] No new literal colors: `grep -cE '#[0-9A-Fa-f]{6}\b' <file>` did not go up.
- [ ] Every number is `font-mono`; no label under 11px.
- [ ] Tabs use `role="tablist"` / `role="tab"` / `aria-selected`; toggles use `aria-pressed`.
- [ ] New pages are in `proxy.ts`'s protected matcher if they need a session, and are
      linked from somewhere (Navbar, avatar menu, or a parent page).
- [ ] Charts: form chosen by the data's job (`dataviz` skill); one hue for magnitude,
      fixed categorical order from tokens, no radar for counts, a legend for ≥2 series,
      status colors only for status.
- [ ] Full-page screenshot at 1440 and 390 shows everything (nothing hidden behind a
      scroll-triggered animation); no horizontal scroll. Locally: start
      `next dev` with the Clerk DEV keys from `.env.e2e`, then
      `PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test --project=shots
      --project=shots-mobile --project=team-shots --project=team-shots-mobile`
      (`E2E_EMAIL=<existing test user>` to reuse a user that owns a team).
- [ ] For a chart or dashboard change, load the `dataviz` skill first; for a new page,
      load `artifact-design` for the fundamentals even though nothing is published.

## Where things are (after the 2026-10 rewrite)

| Concern | Path |
|---|---|
| Tokens, three themes, motion vars | `app/globals.css` (`:root` = CS2, `[data-theme=csgo]`, `[data-theme=khan]`), `lib/theme/config.ts`, `lib/theme/useTheme.ts` |
| Primitives | `components/ui/*` (Button, Card, Badge/ModeBadge/GradeChip, Modal, Tabs, PageHeader, Field, Feedback, Toast) |
| Identity per theme | `components/identity/*` (BrandMark, ProgressMark, Ambience, ThemePicker) |
| Shell | `app/layout.tsx`, `components/shell/*` (Navbar, Footer, Providers, ReferralRedeemer) |
| Data layer | `lib/api/hooks.ts` (every read/mutation), `lib/api/client.ts` (types), `lib/api/contract.md` (what each proxy returns) |
| Upload | `components/upload/*` (UploadModal with ModePicker + DropZone), `lib/upload/useDemoUpload.ts` |
| Pages | `app/page.tsx` (Landing / Home in `components/home`), `app/matches`, `app/analysis/[jobId]` (+ `components/debrief/*`), `app/teams` (+ `components/teams/*`), `app/stratbook` (+ `components/stratbook/*`), `app/settings` (+ `components/settings/*`), `app/settings/admin` (+ `components/admin/*`), `app/billing` |
| Paywall | `components/paywall/UpgradeModal.tsx`; gating shapes in `lib/api/client.ts` (`ReportV2`, `PaywalledPreview`) |
| Replay (beta) | `app/analysis/[jobId]/replay`, `components/minimap/*`, `lib/stores/playback.ts` |
| E2E | `e2e/*.spec.ts`; base URL `https://demo-sage.me` unless `PLAYWRIGHT_BASE_URL` is set; `shots*` projects assert no horizontal scroll and no page errors |
