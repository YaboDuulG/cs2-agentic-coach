/** Small helpers shared by the Team Hub, training and server pages. */

import type { BadgeTone } from "@/components/ui";
import type { StratStatus } from "@/lib/api/client";

export const STATUS_LABEL: Record<StratStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  ACTIVE: "Active",
  ARCHIVED: "Archived",
};

export const STATUS_TONE: Record<StratStatus, BadgeTone> = {
  DRAFT: "neutral",
  IN_REVIEW: "warning",
  ACTIVE: "good",
  ARCHIVED: "neutral",
};

/** Clerk ids carry no name; show a stable short form like `user_…a1b2`. */
export function shortUserId(id: string | null | undefined): string {
  if (!id) return "unknown";
  if (id.length <= 10) return id;
  return `${id.slice(0, 5)}…${id.slice(-4)}`;
}

/** Time left until an ISO timestamp, as "1h 23m", "12m" or "expired". */
export function expiresIn(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.floor((t - now) / 1000);
  if (s <= 0) return "expired";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

export function hoursLabel(seconds: number): string {
  const h = seconds / 3600;
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

export const SERVER_MAPS: { value: string; label: string }[] = [
  { value: "de_dust2", label: "Dust2" },
  { value: "de_mirage", label: "Mirage" },
  { value: "de_inferno", label: "Inferno" },
  { value: "de_nuke", label: "Nuke" },
  { value: "de_ancient", label: "Ancient" },
  { value: "de_anubis", label: "Anubis" },
  { value: "de_vertigo", label: "Vertigo" },
  { value: "de_overpass", label: "Overpass" },
];

export const SERVER_REGIONS: { value: "eu" | "na"; label: string }[] = [
  { value: "eu", label: "Europe" },
  { value: "na", label: "North America" },
];

export function isServerRunning(status: string | null | undefined): boolean {
  return status === "booting" || status === "active";
}
