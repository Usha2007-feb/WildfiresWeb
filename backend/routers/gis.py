"""Public GIS data endpoints — no auth required."""

import json
from fastapi import APIRouter, HTTPException, status
from backend.services.database import query

router = APIRouter(prefix="/api/v1/gis", tags=["gis"])

TYPE_COLORS = {
    "reserve": "#2563EB",
    "buffer_zone": "#F59E0B",
    "core_forest": "#16A34A",
    "eco_sensitive": "#7C3AED",
    "beat_boundary": "#64748B",
    "compartment": "#0EA5E9",
}


@router.get("/map-data")
def get_gis_map_data():
    rows = query(
        """SELECT z.id, z.name, z.type, z.state, z.district, z.area_ha,
                  z.metadata, ST_AsGeoJSON(z.geom) as geojson
           FROM zones z
           WHERE z.geom IS NOT NULL
           ORDER BY z.type, z.name"""
    )
    return [
        {
            "id": r["id"], "name": r["name"], "type": r["type"],
            "state": r.get("state"), "district": r.get("district"),
            "area_ha": r.get("area_ha"),
            "metadata": r.get("metadata") or {},
            "geojson": r["geojson"],
            "color": TYPE_COLORS.get(r["type"], "#94A3B8"),
        }
        for r in rows
    ]


POI_EMOJI: dict[str, str] = {
    "guard_hub": "🏕️",
    "watchtower": "📡",
    "water_source": "💧",
    "fire_station": "🚒",
    "camp": "⛺",
    "checkpoint": "🛂",
    "helipad": "🚁",
    "fuel_depot": "⛽",
}


@router.get("/pois")
def get_pois():
    rows = query(
        """SELECT p.id, p.name, p.type, p.lat, p.lon, p.zone_id, z.name as zone_name,
                  p.metadata
           FROM points_of_interest p
           JOIN zones z ON p.zone_id = z.id
           ORDER BY p.type, p.name"""
    )
    return [
        {
            "id": r["id"], "name": r["name"], "type": r["type"],
            "lat": r["lat"], "lon": r["lon"], "zone_id": r["zone_id"],
            "zone_name": r["zone_name"], "metadata": r.get("metadata") or {},
            "emoji": POI_EMOJI.get(r["type"], "📍"),
        }
        for r in rows
    ]


@router.get("/zones/{zone_id}")
def get_gis_zone_detail(zone_id: int):
    rows = query(
        """SELECT z.id, z.name, z.type, z.state, z.district, z.area_ha,
                  z.metadata, ST_AsGeoJSON(z.geom) as geojson
           FROM zones z WHERE z.id = %s""",
        (zone_id,),
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")

    r = rows[0]
    children = query(
        """SELECT c.id, c.name, c.type
           FROM zone_hierarchy h JOIN zones c ON h.child_zone_id = c.id
           WHERE h.parent_zone_id = %s""",
        (zone_id,),
    )

    return {
        "id": r["id"], "name": r["name"], "type": r["type"],
        "state": r.get("state"), "district": r.get("district"),
        "area_ha": r.get("area_ha"),
        "metadata": r.get("metadata") or {},
        "geojson": r["geojson"],
        "color": TYPE_COLORS.get(r["type"], "#94A3B8"),
        "children": [{"id": c["id"], "name": c["name"], "type": c["type"]} for c in children],
    }
