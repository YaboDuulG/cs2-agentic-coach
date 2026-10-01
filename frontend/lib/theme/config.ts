// Server-safe theme registry (no "use client") so layout.tsx can inline the
// pre-paint bootstrap. Palettes live in app/globals.css under [data-theme];
// this file carries what components need to know: id, label, which heading
// face, which identity mark, which ambience layer.

export type ThemeId = "cs2" | "csgo" | "khan";

export interface ThemeDef {
  id: ThemeId;
  label: string;
  description: string;
  /** Identity mark used by the logo and the pipeline progress screen. */
  mark: "radar" | "crosshair" | "soyombo";
  /** Page background layer rendered by <Ambience/>. */
  ambience: "grid" | "scanlines" | "cloud";
  /** Swatch for the picker: [surface, accent]. Display only. */
  swatch: [string, string];
}

export const THEMES: ThemeDef[] = [
  {
    id: "cs2",
    label: "Counter-Strike 2",
    description: "Slate and signal orange, radar grid",
    mark: "radar",
    ambience: "grid",
    swatch: ["#0F141B", "#F2A33A"],
  },
  {
    id: "csgo",
    label: "Global Offensive",
    description: "Near-black, Global orange, condensed type",
    mark: "crosshair",
    ambience: "scanlines",
    swatch: ["#0A0A0A", "#F58B1F"],
  },
  {
    id: "khan",
    label: "The Great Khan",
    description: "Eternal blue sky, gold, Soyombo",
    mark: "soyombo",
    ambience: "cloud",
    swatch: ["#050C15", "#C9A227"],
  },
];

export const DEFAULT_THEME: ThemeId = "cs2";
export const THEME_STORAGE_KEY = "demosage-theme";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((t) => t.id === value);
}

export function themeDef(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/**
 * Inline bootstrap for layout.tsx: applies a saved non-default theme before
 * first paint so a CS:GO or Khan user never sees the CS2 palette flash.
 */
export const THEME_BOOTSTRAP_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t&&t!==${JSON.stringify(DEFAULT_THEME)}&&${JSON.stringify(THEMES.map((t) => t.id))}.indexOf(t)>-1)document.documentElement.setAttribute("data-theme",t);}catch(e){}`;
