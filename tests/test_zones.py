"""
Zone-layer tests — resolver geometry (hit / miss / z-floor preference) against
both seed data and fabricated stacked boxes, plus seed idempotency on SQLite.
"""

import os

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Base, MapZone
from services.tactician.zones import (
    DEFAULT_ZONES,
    ZoneBox,
    default_zones_for,
    load_zones,
    resolve_zone,
    seed_default_zones,
)


@pytest.fixture()
def db_session():
    """Docstring for db_session."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


# ---------------------------------------------------------------------------
# resolve_zone
# ---------------------------------------------------------------------------


def test_resolver_hit_inside_seeded_box():
    """A point inside Mirage's A-site box resolves to its zone_key."""
    zones = default_zones_for("de_mirage")
    assert resolve_zone(zones, -500.0, -2000.0) == "Mirage_A_Site"


def test_resolver_miss_returns_none():
    """Docstring for test_resolver_miss_returns_none."""
    zones = default_zones_for("de_mirage")
    assert resolve_zone(zones, 5000.0, 5000.0) is None
    assert resolve_zone([], 0.0, 0.0) is None


def test_resolver_prefers_floor_closest_below_z():
    """Two xy-identical stacked boxes: z picks the floor closest below."""
    lower = ZoneBox("de_test", "Test_Lower", "Lower", 0, 0, 100, 100, z_floor=-500.0, tag="site")
    upper = ZoneBox("de_test", "Test_Upper", "Upper", 0, 0, 100, 100, z_floor=0.0, tag="site")
    zones = [lower, upper]

    assert resolve_zone(zones, 50.0, 50.0, z=40.0) == "Test_Upper"  # 0 is closest below 40
    assert resolve_zone(zones, 50.0, 50.0, z=-450.0) == "Test_Lower"
    # No z given → first containing box wins, list order.
    assert resolve_zone(zones, 50.0, 50.0) == "Test_Lower"


def test_resolver_z_falls_back_when_all_floors_above():
    """z below every floor → an unfloored box wins; else the first hit does."""
    floored = ZoneBox("de_test", "Test_Top", "Top", 0, 0, 100, 100, z_floor=200.0)
    unfloored = ZoneBox("de_test", "Test_Anywhere", "Anywhere", 0, 0, 100, 100)

    assert resolve_zone([floored, unfloored], 50.0, 50.0, z=-50.0) == "Test_Anywhere"
    assert resolve_zone([floored], 50.0, 50.0, z=-50.0) == "Test_Top"  # approximate-data fallback


def test_nuke_sites_carry_z_floors():
    """Nuke A/B stack vertically; the seed disambiguates them by floor."""
    by_key = {zb.zone_key: zb for zb in default_zones_for("de_nuke")}
    assert by_key["Nuke_A_Site"].z_floor is not None
    assert by_key["Nuke_B_Site"].z_floor is not None
    assert by_key["Nuke_A_Site"].z_floor > by_key["Nuke_B_Site"].z_floor
    # A point inside the A box at A's height resolves to A.
    zones = default_zones_for("de_nuke")
    assert resolve_zone(zones, 600.0, -800.0, z=-400.0) == "Nuke_A_Site"


# ---------------------------------------------------------------------------
# seeding
# ---------------------------------------------------------------------------


def test_seed_is_idempotent(db_session):
    """Second seed adds nothing and touches no existing rows."""
    added = seed_default_zones(db_session)
    assert added == len(DEFAULT_ZONES) > 0
    assert seed_default_zones(db_session) == 0
    assert db_session.query(MapZone).count() == len(DEFAULT_ZONES)


def test_seed_skips_existing_curated_row(db_session):
    """A pre-existing (map, zone_key) row survives seeding unmodified."""
    db_session.add(
        MapZone(
            map_name="de_mirage", zone_key="Mirage_A_Site", display_name="Curated A",
            min_x=-1.0, min_y=-1.0, max_x=1.0, max_y=1.0, tag="site",
        )
    )
    db_session.commit()

    assert seed_default_zones(db_session) == len(DEFAULT_ZONES) - 1
    curated = (
        db_session.query(MapZone)
        .filter_by(map_name="de_mirage", zone_key="Mirage_A_Site")
        .one()
    )
    assert curated.display_name == "Curated A"


def test_load_zones_roundtrips_seed(db_session):
    """load_zones returns the seeded boxes with tags intact, resolvable."""
    seed_default_zones(db_session)
    zones = load_zones(db_session, "de_inferno")
    assert {zb.zone_key for zb in zones} == {
        "Inferno_A_Site", "Inferno_B_Site", "Inferno_Banana",
        "Inferno_T_Spawn", "Inferno_CT_Spawn",
    }
    banana = next(zb for zb in zones if zb.zone_key == "Inferno_Banana")
    assert banana.tag == "choke"
    assert resolve_zone(zones, 100.0, 1800.0) == "Inferno_Banana"
    assert load_zones(db_session, "de_train") == []
