"""
Coordinate translation utility mapping X/Y bounding boxes to semantic callouts.
This drastically reduces LLM token overhead by aggregating tick data into named zones.
"""

MAP_ZONES = {
    "de_mirage": [
        # [xmin, xmax, ymin, ymax, "Standard Name", ["Alias 1", "Alias 2"]]
        [-1500, -500, -2000, -1000, "A-Site Default", ["Firebox", "Ninja", "Triple"]],
        [-2000, -1500, -2000, -1000, "A-Ramp", ["T-Ramp"]],
        [-1000, 0, -1000, 0, "A-Connector", ["Conn"]],
        [-500, 500, -500, 500, "Mid-Window", ["Nest", "Sniper's Nest"]],
        [0, 1000, -1000, 0, "Top-Mid", ["T-Mid"]],
        [500, 1500, -500, 500, "B-Short", ["Catwalk", "Cat"]],
        [1000, 2000, 500, 1500, "B-Apps", ["Apartments"]],
        [500, 1500, 1000, 2500, "B-Site", ["Bench", "Van"]],
        [-2500, -1500, 1000, 2000, "T-Spawn", []],
        [-1500, -500, 1500, 2500, "CT-Spawn", ["Ticket"]],
    ]
}


def get_zone_for_coordinate(map_name: str, x: float, y: float) -> str:
    """
    Given an X/Y coordinate and map name, returns the semantic zone name with aliases.
    Example output: "A-Site Default (Aliases: Firebox, Ninja, Triple)"
    """
    zones = MAP_ZONES.get(map_name, [])

    for zone in zones:
        xmin, xmax, ymin, ymax, standard_name, aliases = zone
        if xmin <= x <= xmax and ymin <= y <= ymax:
            if aliases:
                alias_str = ", ".join(aliases)
                return f"{standard_name} (Aliases: {alias_str})"
            return standard_name

    # Fallback to generic quadrant if we don't have a specific bounding box
    if x < 0 and y < 0:
        return "Bottom-Left Quadrant"
    elif x > 0 and y < 0:
        return "Bottom-Right Quadrant"
    elif x < 0 and y > 0:
        return "Top-Left Quadrant"
    else:
        return "Top-Right Quadrant"
