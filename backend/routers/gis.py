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
