/**
 * Radar calibration per map: the numbers from each map's overview file that
 * place world coordinates on the 1024×1024 radar image.
 *   radar_x = (x - pos_x) / scale
 *   radar_y = (pos_y - y) / scale   (world y points up, the image down)
 * de_dust2 was checked against a real demo on 2026-10-05 (every trajectory
 * point lands on walkable ground with these values; the older -2400/3383
 * pair put them in walls).
 */
export interface RadarCalibration {
  pos_x: number;
  pos_y: number;
  scale: number;
}

export const RADAR_SIZE = 1024;

export const RADAR_CALIBRATION: Record<string, RadarCalibration> = {
  de_mirage: { pos_x: -3230, pos_y: 1713, scale: 5 },
  de_inferno: { pos_x: -2087, pos_y: 3870, scale: 4.9 },
  de_nuke: { pos_x: -3453, pos_y: 2887, scale: 7 },
  de_vertigo: { pos_x: -3168, pos_y: 1762, scale: 4 },
  de_ancient: { pos_x: -2953, pos_y: 2164, scale: 5 },
  de_anubis: { pos_x: -2796, pos_y: 3328, scale: 5.22 },
  de_dust2: { pos_x: -2476, pos_y: 3239, scale: 4.4 },
  de_overpass: { pos_x: -4831, pos_y: 1781, scale: 5.2 },
  de_train: { pos_x: -2308, pos_y: 2078, scale: 4.082077 },
  de_cache: { pos_x: -2000, pos_y: 3250, scale: 5.5 },
};

/** "maps/de_mirage" / "DE_MIRAGE" → "de_mirage". */
export function mapKey(map: string | null | undefined): string {
  return (map ?? "").split("/").pop()?.toLowerCase() ?? "";
}

export function radarCalibration(map: string | null | undefined): RadarCalibration | null {
  return RADAR_CALIBRATION[mapKey(map)] ?? null;
}

/**
 * The radar image for a map. One source for the planning board, the 2D
 * replay and the 3D viewer; NEXT_PUBLIC_MINIMAP_BASE_URL overrides it with
 * a self-hosted folder of `<map>.png` files.
 */
export function radarImageUrl(map: string | null | undefined): string {
  const key = mapKey(map);
  const base = process.env.NEXT_PUBLIC_MINIMAP_BASE_URL;
  if (base) return `${base.replace(/\/$/, "")}/${key}.png`;
  return `https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars/${key}_radar_psd.png`;
}

/** World → radar pixel (0..1024). */
export function worldToRadar(cal: RadarCalibration, x: number, y: number): { x: number; y: number } {
  return { x: (x - cal.pos_x) / cal.scale, y: (cal.pos_y - y) / cal.scale };
}
