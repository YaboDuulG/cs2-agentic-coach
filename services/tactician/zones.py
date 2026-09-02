"""
Canonical zone layer — the coordinate→language bridge (DATA_ARCHITECTURE §4.1).
=================================================================================
ZoneBox + resolve_zone are pure (no DB) so feature extractors can consume them;
load_zones/seed_default_zones lazy-import db.models to keep the module import
side-effect free. DEFAULT_ZONES is the single source of truth for per-map
callout boxes: services/rag_engine/extractor.py rebuilds its MAP_GEOMETRY from
it and the worker seeds the map_zones table from it at startup.

Coordinate provenance:
  - de_mirage / de_inferno / de_nuke / de_anubis boxes are the extractor's
    long-standing zone tables verbatim — do not retune them casually, the
    pinned archetype-label tests depend on them. Spawn boxes are ±128u around
    the extractor's historical T/CT spawn anchor points (box center == anchor).
  - de_dust2 / de_ancient / de_vertigo are new, deliberately coarse
    approximations awaiting curation against real radar data.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ZoneBox:
    """One axis-aligned callout box. z_floor disambiguates stacked floors
    (Nuke A over B); NULL/None means the box matches any height."""

    map_name: str
    zone_key: str
    display_name: str
    min_x: float
    min_y: float
    max_x: float
    max_y: float
    z_floor: float | None = None
    tag: str = ""  # 'site' | 'choke' | 'mid' | 'spawn' | ''

    def contains_xy(self, x: float, y: float) -> bool:
        """Docstring for contains_xy."""
        return self.min_x <= x <= self.max_x and self.min_y <= y <= self.max_y


def _spawn(map_name: str, prefix: str, side: str, cx: float, cy: float) -> ZoneBox:
    """±128u anchor box; the box center IS the side's spawn anchor point."""
    return ZoneBox(
        map_name, f"{prefix}_{side}_Spawn", f"{side} Spawn",
        cx - 128.0, cy - 128.0, cx + 128.0, cy + 128.0, tag="spawn",
    )


DEFAULT_ZONES: tuple[ZoneBox, ...] = (
    # --- de_mirage (bounds from rag_engine/extractor) ---
    ZoneBox("de_mirage", "Mirage_A_Site", "A Site", -1200.0, -2700.0, 100.0, -1500.0, tag="site"),
    ZoneBox("de_mirage", "Mirage_B_Site", "B Site", -2600.0, 0.0, -1400.0, 1000.0, tag="site"),
    ZoneBox("de_mirage", "Mirage_Mid", "Mid", -1000.0, -1200.0, 0.0, 0.0, tag="mid"),
    _spawn("de_mirage", "Mirage", "T", 1200.0, -1600.0),
    _spawn("de_mirage", "Mirage", "CT", -2100.0, -1000.0),
    # --- de_inferno (bounds from rag_engine/extractor) ---
    ZoneBox("de_inferno", "Inferno_A_Site", "A Site", 1500.0, 100.0, 2700.0, 1100.0, tag="site"),
    ZoneBox("de_inferno", "Inferno_B_Site", "B Site", 100.0, 2400.0, 1200.0, 3700.0, tag="site"),
    ZoneBox("de_inferno", "Inferno_Banana", "Banana", -300.0, 1200.0, 500.0, 2400.0, tag="choke"),
    _spawn("de_inferno", "Inferno", "T", -1500.0, 300.0),
    _spawn("de_inferno", "Inferno", "CT", 2400.0, 1900.0),
    # --- de_nuke (bounds from rag_engine/extractor; z floors added for the
    # A-over-B vertical stack: A sits around z≈-416, B around z≈-766) ---
    ZoneBox("de_nuke", "Nuke_A_Site", "A Site", 200.0, -1400.0, 1200.0, -300.0,
            z_floor=-416.0, tag="site"),
    ZoneBox("de_nuke", "Nuke_B_Site", "B Site", 300.0, -300.0, 1100.0, 600.0,
            z_floor=-766.0, tag="site"),
    ZoneBox("de_nuke", "Nuke_Ramp", "Ramp", -500.0, -2200.0, 700.0, -1400.0, tag="choke"),
    _spawn("de_nuke", "Nuke", "T", -2000.0, -1200.0),
    _spawn("de_nuke", "Nuke", "CT", 2600.0, -900.0),
    # --- de_anubis (bounds from rag_engine/extractor) ---
    ZoneBox("de_anubis", "Anubis_A_Site", "A Site", 700.0, 800.0, 1900.0, 2000.0, tag="site"),
    ZoneBox("de_anubis", "Anubis_B_Site", "B Site", -1900.0, 600.0, -700.0, 1800.0, tag="site"),
    ZoneBox("de_anubis", "Anubis_Mid", "Mid", -500.0, -400.0, 500.0, 800.0, tag="mid"),
    _spawn("de_anubis", "Anubis", "T", 0.0, -2200.0),
    _spawn("de_anubis", "Anubis", "CT", 300.0, 2200.0),
    # --- de_dust2 — APPROXIMATE bounds (coarse radar estimates, uncurated) ---
    ZoneBox("de_dust2", "Dust2_A_Site", "A Site", 800.0, 2000.0, 1600.0, 3000.0, tag="site"),
    ZoneBox("de_dust2", "Dust2_B_Site", "B Site", -2100.0, 1900.0, -1300.0, 3000.0, tag="site"),
    ZoneBox("de_dust2", "Dust2_Long_A", "Long A", 1100.0, 300.0, 1600.0, 1300.0, tag="choke"),
    ZoneBox("de_dust2", "Dust2_Mid_Doors", "Mid Doors", -600.0, 1000.0, -100.0, 1600.0,
            tag="choke"),
    ZoneBox("de_dust2", "Dust2_B_Tunnels", "B Tunnels", -2300.0, 900.0, -1600.0, 1400.0,
            tag="choke"),
    _spawn("de_dust2", "Dust2", "T", -500.0, -2700.0),  # approximate anchor
    _spawn("de_dust2", "Dust2", "CT", -300.0, 2500.0),  # approximate anchor
    # --- de_ancient — APPROXIMATE bounds (coarse radar estimates, uncurated) ---
    ZoneBox("de_ancient", "Ancient_A_Site", "A Site", -2000.0, 600.0, -1100.0, 1400.0, tag="site"),
    ZoneBox("de_ancient", "Ancient_B_Site", "B Site", 600.0, 400.0, 1500.0, 1200.0, tag="site"),
    ZoneBox("de_ancient", "Ancient_Mid", "Mid", -400.0, -400.0, 400.0, 400.0, tag="mid"),
    ZoneBox("de_ancient", "Ancient_A_Main", "A Main", -1600.0, -600.0, -900.0, 100.0, tag="choke"),
    ZoneBox("de_ancient", "Ancient_B_Ramp", "B Ramp", 700.0, -700.0, 1400.0, -100.0, tag="choke"),
    _spawn("de_ancient", "Ancient", "T", 0.0, -2300.0),  # approximate anchor
    _spawn("de_ancient", "Ancient", "CT", 0.0, 2000.0),  # approximate anchor
    # --- de_vertigo — APPROXIMATE bounds (coarse estimates, uncurated; the
    # tower's playable decks sit around z≈11500-11800, so site boxes carry a
    # top-deck z_floor and B Stairs the lower-deck one) ---
    ZoneBox("de_vertigo", "Vertigo_A_Site", "A Site", -2200.0, 400.0, -1300.0, 1200.0,
            z_floor=11540.0, tag="site"),
    ZoneBox("de_vertigo", "Vertigo_B_Site", "B Site", -1000.0, 300.0, -200.0, 1100.0,
            z_floor=11540.0, tag="site"),
    ZoneBox("de_vertigo", "Vertigo_A_Ramp", "A Ramp", -2900.0, -400.0, -2300.0, 500.0,
            tag="choke"),
    ZoneBox("de_vertigo", "Vertigo_Mid", "Mid", -1500.0, -300.0, -800.0, 300.0, tag="mid"),
    ZoneBox("de_vertigo", "Vertigo_B_Stairs", "B Stairs", -500.0, -500.0, 100.0, 200.0,
            z_floor=11220.0, tag="choke"),
    _spawn("de_vertigo", "Vertigo", "T", -1400.0, -1800.0),  # approximate anchor
    _spawn("de_vertigo", "Vertigo", "CT", -2400.0, 1600.0),  # approximate anchor
)


def default_zones_for(map_name: str) -> list[ZoneBox]:
    """The curated seed boxes for one map (empty list for unseeded maps)."""
    return [zb for zb in DEFAULT_ZONES if zb.map_name == map_name]


def resolve_zone(zones: list[ZoneBox], x: float, y: float, z: float | None = None) -> str | None:
    """
    zone_key of the first box containing (x, y), or None. When z is given and
    containing boxes carry z floors, prefer the box whose floor is closest
    below z (Nuke A-over-B verticality); boxes without a floor act as a
    fallback, and if every floor sits above z the first hit wins (approximate
    seed data beats returning nothing).
    """
    hits = [zb for zb in zones if zb.contains_xy(x, y)]
    if not hits:
        return None
    if z is not None:
        floored_below = [zb for zb in hits if zb.z_floor is not None and zb.z_floor <= z]
        if floored_below:
            return max(floored_below, key=lambda zb: zb.z_floor).zone_key  # type: ignore[arg-type, return-value]
        unfloored = [zb for zb in hits if zb.z_floor is None]
        if unfloored:
            return unfloored[0].zone_key
    return hits[0].zone_key


def load_zones(db, map_name: str) -> list[ZoneBox]:
    """All map_zones rows for one map as ZoneBoxes, in insertion (id) order."""
    from db.models import MapZone  # noqa: PLC0415 — keeps the module DB-free

    return [
        ZoneBox(
            map_name=row.map_name,
            zone_key=row.zone_key,
            display_name=row.display_name,
            min_x=row.min_x,
            min_y=row.min_y,
            max_x=row.max_x,
            max_y=row.max_y,
            z_floor=row.z_floor,
            tag=row.tag,
        )
        for row in db.query(MapZone).filter(MapZone.map_name == map_name).order_by(MapZone.id)
    ]


def seed_default_zones(db) -> int:
    """
    Insert any DEFAULT_ZONES rows missing from map_zones; returns how many were
    added. Idempotent on (map_name, zone_key) — existing rows (curated edits
    included) are never touched.
    """
    from db.models import MapZone  # noqa: PLC0415 — keeps the module DB-free

    existing = set(db.query(MapZone.map_name, MapZone.zone_key))
    added = 0
    for zb in DEFAULT_ZONES:
        if (zb.map_name, zb.zone_key) in existing:
            continue
        db.add(
            MapZone(
                map_name=zb.map_name,
                zone_key=zb.zone_key,
                display_name=zb.display_name,
                min_x=zb.min_x,
                min_y=zb.min_y,
                max_x=zb.max_x,
                max_y=zb.max_y,
                z_floor=zb.z_floor,
                tag=zb.tag,
            )
        )
        added += 1
    if added:
        db.commit()
    return added
