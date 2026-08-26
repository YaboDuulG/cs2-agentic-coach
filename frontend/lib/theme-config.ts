// Server-safe theme configuration — no "use client" so layout.tsx (a server
// component) can import the bootstrap script. Hooks live in lib/themes.ts.

export type ThemeId = "khan" | "purple-void" | "tactical";

export interface ThemeDef {
  id: ThemeId;
  label: string;
  description: string;
  /** Representative accent, for swatches in the theme picker. */
  accent: string;
  /**
   * Whether this theme renders its cultural/decorative identity layer
   * (logo mark variant, patterned dividers, ambient background motifs).
   * Only the Great Khan theme ships motifs today; new themes can bring their own.
   */
  motifs: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: "khan", label: "The Great Khan", description: "Eternal Blue Sky & Gold", accent: "#2D7DD2", motifs: true },
  { id: "purple-void", label: "Purple Void", description: "Deep Space Violet", accent: "#7C3AED", motifs: false },
  { id: "tactical", label: "Tactical Command", description: "Gunmetal & Green", accent: "#22C55E", motifs: false },
];

export const DEFAULT_THEME: ThemeId = "khan";
export const THEME_STORAGE_KEY = "demosage-theme";

/**
 * Inline bootstrap for layout.tsx — sets data-theme before first paint so a
 * saved non-default theme doesn't flash the Khan palette on load.
 */
export const THEME_BOOTSTRAP_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t&&t!==${JSON.stringify(DEFAULT_THEME)})document.documentElement.setAttribute("data-theme",t);}catch(e){}`;
