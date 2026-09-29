---
name: demosage-frontend
description: Use when building, reviewing, or refactoring anything under frontend/ in DemoSage (Next.js 15 + Tailwind v4). Encodes the design system (tokens, fonts, motion budget, ui primitives), the page rules every route must satisfy, and the UX-review checklist from frontend/UX_REVIEW.md. Triggers on "frontend", "page", "component", "navbar", "debrief", "analysis page", "design", "UX", "theme", "chart", "Tailwind", "tsx".
---

# DemoSage frontend

Source of truth, in precedence order: the user's words → `frontend/FRONTEND_REFACTOR_PLAN.md`
(the plan: target IA, upload flow, theme slots, shell, debrief) → `frontend/DESIGN_PLAN.md`
(design system) → `frontend/UX_REVIEW.md` (evidence: findings and capture specs) → this file.

## Non-negotiables

1. **Colors come from tokens.** `var(--color-…)` from `app/globals.css`, never a literal
   hex, never Tailwind palette classes (`slate-*`, `neutral-*`, `blue-500`). Three themes
   switch on `[data-theme]`; a literal breaks two of them. Side colors are
   `--color-ct` / `--color-t`. Gold (`--color-accent-secondary`) means rank or
   achievement; blue (`--color-accent-primary`) means action; `--color-danger` means
   death or error, never decoration.
2. **Fonts by role.** `var(--font-heading)` for page titles and section headings only,
   `var(--font-body)` for prose, `var(--font-mono)` for every number (economy, K/D,
   ticks, rounds, timers). Data labels never below 11px.
3. **Primitives first.** `components/ui`: `Button`, `Card`, `Modal`, `Progress`,
   `Spinner`, `Toast`, `PageTransition`, `PageSection`. No shadcn, no new UI library.
   Errors go through `toast()`, never `alert()`.
4. **Motion budget.** Transitions name properties (no `transition-all`), under 300ms,
   `--ease-out`, never ease-in. One page-enter fade-up via `PageTransition`; the only
   orchestrated moment is `SoyomboProgress` on the waiting screen. Content must be
   visible at rest — never leave sections at `opacity: 0` waiting for `whileInView`.
   Respect `prefers-reduced-motion`.
5. **Data flow.** Server routes under `app/api/*` attach auth and the shared secret;
   components never call FastAPI directly. New reads go through TanStack Query hooks in
   `lib/api/hooks.ts`, not hand-rolled `useEffect` poll loops. Playback tick state lives in
   the Zustand store (`lib/stores/playback.ts`), never in React state.
6. **Gating is server-driven.** Components render the shape the server sent (full,
   redacted, teaser). No client-side hiding of paid content.
7. **Mode belongs to the match**, not to a global preference. Do not add readers of
   `localStorage.coaching_mode` or the `coachingModeChange` event; FRONTEND_REFACTOR_PLAN
   W1/W2 remove them and put the choice in the upload modal's mode picker.

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
      scroll-triggered animation); no horizontal scroll.
- [ ] For a chart or dashboard change, load the `dataviz` skill first; for a new page,
      load `artifact-design` for the fundamentals even though nothing is published.

## Where things are

| Concern | Path |
|---|---|
| Tokens, themes, motion vars | `app/globals.css`, `lib/theme-config.ts`, `lib/themes.ts` |
| Nav and upload entry | `components/Navbar.tsx`, `components/UploadModal.tsx`, `components/UploadZone.tsx` |
| Debrief | `app/analysis/[jobId]/page.tsx` (being split into `components/debrief/*`), `components/analysis/*` |
| Paywall shapes | `components/paywall/*`, `lib/api/client.ts` (`ReportV2`, `PaywalledPreview`) |
| Replay (beta) | `app/analysis/[jobId]/replay`, `components/minimap/*` |
| E2E | `e2e/*.spec.ts`, runs against the deployed app unless `PLAYWRIGHT_BASE_URL` is set |
