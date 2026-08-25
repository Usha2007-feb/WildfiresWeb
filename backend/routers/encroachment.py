"""Encroachment detection API router.

Endpoints
---------
GET  /api/v1/encroachment/status
GET  /api/v1/encroachment/{region}/analysis?before=2019&after=2023
GET  /api/v1/encroachment/{region}/imagery/{year}/{z}/{x}/{y}.png
GET  /api/v1/encroachment/{region}/{year}/index/{layer}/{z}/{x}/{y}.png
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response

from backend.services.encroachment import (
    ImageryUnavailable,
    analyse,
    available_years,
    imagery_tile,
)
from backend.services.index_tile import (
    LC_PALETTE,
    CHANGE_PALETTE,
    INDEX_BAND,
    render_index_tile,
)

router = APIRouter(prefix="/api/v1/encroachment", tags=["encroachment"])
REGIONS = ("laisong", "corbett", "jyotikuchi", "similipal")

VALID_LAYERS = set(INDEX_BAND.keys())   # ndvi, evi, nbr, ndmi, bsi


@router.get("/status")
def status():
    return {
        "regions": [
            {"id": region, "available_years": available_years(region)}
            for region in REGIONS
        ],
        "index_layers": list(VALID_LAYERS),
    }


@router.get("/{region}/analysis")
def get_analysis(region: str, before: int = Query(...), after: int = Query(...)):
    if region not in REGIONS:
        raise HTTPException(404, "Unknown case-study region")
    try:
        return analyse(region, before, after)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except ImageryUnavailable as exc:
        raise HTTPException(
            424,
            {
                "status": "imagery_unavailable",
                "message": str(exc),
                "available_years": available_years(region),
            },
        ) from exc


@router.get("/{region}/imagery/{year}/{z}/{x}/{y}.png")
def get_imagery_tile(region: str, year: int, z: int, x: int, y: int):
    if region not in REGIONS:
        raise HTTPException(404, "Unknown case-study region")
    try:
        tile = imagery_tile(region, year, z, x, y)
        return Response(
            tile,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except ImageryUnavailable as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/{region}/{year}/index/{layer}/{z}/{x}/{y}.png")
def get_index_tile(
    region: str,
    year: int,
    layer: str,
    z: int,
    x: int,
    y: int,
):
    """Serve a 256×256 RGBA PNG colourmap tile for a single index band.

    ``layer`` must be one of: ndvi, evi, nbr, ndmi, bsi.
    """
    if region not in REGIONS:
        raise HTTPException(404, "Unknown case-study region")
    if layer not in VALID_LAYERS:
        raise HTTPException(
            400,
            f"Unknown layer '{layer}'. Valid layers: {sorted(VALID_LAYERS)}",
        )
    try:
        tile = render_index_tile(region, year, layer, z, x, y)
        if not tile:
            return Response(
                b"",
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=3600"},
            )
        return Response(
            tile,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"Tile rendering failed: {exc}") from exc
