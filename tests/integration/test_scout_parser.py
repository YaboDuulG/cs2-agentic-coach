from pathlib import Path

# Adjust path to import Scout correctly
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

try:
    from services.scout.parse_demo import parse_demo

    HAS_DEMOPARSER = True
except ImportError:
    HAS_DEMOPARSER = False

pytestmark = pytest.mark.skipif(
    not HAS_DEMOPARSER, reason="demoparser2 or its dependencies not installed"
)


@pytest.fixture
def sample_demo():
    # Use the existing E2E demo
    demo_path = Path(__file__).parent.parent / "e2e" / "default.dem"
    if not demo_path.exists():
        pytest.skip(f"Test demo not found at {demo_path}")
    return str(demo_path)


def test_scout_parser_coordinates(sample_demo):
    """Verifies that the Scout correctly extracts XYZ coordinates from demoparser2."""
    output = parse_demo(sample_demo)

    assert "kills" in output, "Output must contain kills"

    kills = output["kills"]
    if not kills:
        pytest.skip("No kills found in this demo, cannot verify coordinates.")

    for kill in kills:
        # If coordinates are perfectly 0.0, it usually means the column extraction failed
        # because the center of the map is rarely a kill location in competitive CS2.
        assert not (kill["attacker_x"] == 0.0 and kill["attacker_y"] == 0.0), (
            f"Attacker X/Y coords are exactly 0.0 (extraction failed). Kill: {kill}"
        )
        assert not (kill["victim_x"] == 0.0 and kill["victim_y"] == 0.0), (
            f"Victim X/Y coords are exactly 0.0 (extraction failed). Kill: {kill}"
        )


def test_scout_parser_grenades(sample_demo):
    """Verifies that the Scout correctly extracts grenade throws."""
    output = parse_demo(sample_demo)

    assert "grenades" in output, "Output must contain grenades"

    grenades = output["grenades"]
    if not grenades:
        pytest.skip("No grenades found in this demo, cannot verify extraction.")

    for nade in grenades:
        assert not (nade["throw_x"] == 0.0 and nade["throw_y"] == 0.0), (
            f"Grenade X/Y coords are exactly 0.0 (extraction failed). Nade: {nade}"
        )
        assert "type" in nade, "Grenade must have a type"
