"""
Spatial service for geo-fence point-in-polygon queries.
Checks which management zone (core/buffer/eco-sensitive) a given coordinate falls within.
"""
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_GEO_FENCE_PATH = Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "gis" / "geo_fence_zones.geojson"
_RESERVES_PATH = Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "forestReserves.geojson"

_geo_fence_data = None
_reserves_data = None


def _load_geo_fence():
    global _geo_fence_data
    if _geo_fence_data is not None:
        return _geo_fence_data
    if not _GEO_FENCE_PATH.exists():
        logger.warning(f"Geo-fence GeoJSON not found at {_GEO_FENCE_PATH}")
        _geo_fence_data = []
        return _geo_fence_data
    with open(_GEO_FENCE_PATH) as f:
        data = json.load(f)
    _geo_fence_data = data.get("features", [])
    logger.info(f"Loaded {len(_geo_fence_data)} geo-fence zone features")
    return _geo_fence_data


def _load_reserves():
    global _reserves_data
    if _reserves_data is not None:
        return _reserves_data
    if not _RESERVES_PATH.exists():
        logger.warning(f"Reserves GeoJSON not found at {_RESERVES_PATH}")
        _reserves_data = []
        return _reserves_data
    with open(_RESERVES_PATH) as f:
        data = json.load(f)
    _reserves_data = data.get("features", [])
    logger.info(f"Loaded {len(_reserves_data)} reserve boundary features")
    return _reserves_data


def _point_in_polygon(lat: float, lon: float, coordinates: list) -> bool:
    """Ray casting algorithm for point-in-polygon check."""
    ring = coordinates[0] if coordinates and isinstance(coordinates[0][0], list) else coordinates
    x, y = lon, lat
    n = len(ring)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def point_in_zone(lat: float, lon: float) -> list[dict]:
    """
    Returns all geo-fence zones that contain the given point.
    Each result dict has: region_id, zone_type, name, protection_level.
    Priority order: core > buffer > eco_sensitive.
    """
    features = _load_geo_fence()
    matches = []
    priority = {"core_zone": 3, "buffer_zone": 2, "eco_sensitive_zone": 1}

    for feature in features:
        geom = feature.get("geometry", {})
        if geom.get("type") != "Polygon":
            continue
        coords = geom.get("coordinates", [])
        if not coords:
            continue
        try:
            if _point_in_polygon(lat, lon, coords):
                props = feature.get("properties", {})
                matches.append({
                    "region_id": props.get("region_id"),
                    "zone_type": props.get("zone_type"),
                    "name": props.get("name"),
                    "protection_level": props.get("protection_level"),
                    "priority": priority.get(props.get("zone_type", ""), 0),
                })
        except Exception as e:
            logger.debug(f"Error checking feature: {e}")

    matches.sort(key=lambda x: x["priority"], reverse=True)
    return matches


def point_in_reserve(lat: float, lon: float) -> dict | None:
    """
    Returns the monitored reserve that contains the given point, or None.
    """
    features = _load_reserves()
    for feature in features:
        geom = feature.get("geometry", {})
        if geom.get("type") != "Polygon":
            continue
        coords = geom.get("coordinates", [])
        if not coords:
            continue
        try:
            if _point_in_polygon(lat, lon, coords):
                props = feature.get("properties", {})
                return {
                    "id": props.get("id"),
                    "name": props.get("name"),
                    "state": props.get("state"),
                    "division": props.get("division"),
                }
        except Exception as e:
            logger.debug(f"Error checking reserve feature: {e}")
    return None


def check_alert_zones(lat: float, lon: float) -> dict:
    """
    Given a coordinate (e.g. from a fire detection alert), determines:
    - Which reserve it falls in (if any)
    - Which management zone (core/buffer/eco) within that reserve
    - Whether to escalate alert priority
    Returns a dict with context for prioritizing alerts.
    """
    reserve = point_in_reserve(lat, lon)
    zones = point_in_zone(lat, lon)
    top_zone = zones[0] if zones else None

    result = {
        "inside_reserve": reserve is not None,
        "reserve": reserve,
        "zone": top_zone,
        "alert_priority": "normal",
    }

    if top_zone:
        if top_zone["zone_type"] == "core_zone":
            result["alert_priority"] = "critical"
        elif top_zone["zone_type"] == "buffer_zone":
            result["alert_priority"] = "high"
        elif top_zone["zone_type"] == "eco_sensitive_zone":
            result["alert_priority"] = "elevated"

    return result
