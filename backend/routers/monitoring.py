"""Satellite monitoring and change detection API."""

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from backend.services.database import query, execute, execute_returning
from backend.services.satellite_provider import get_provider, DemoProvider, SatelliteScanResult

router = APIRouter(prefix="/api/v1/monitoring", tags=["monitoring"])


class ScanRequest(BaseModel):
    zone_id: int
    before_year: int = 2005
    after_year: int = 2025


@router.get("/history")
def get_scan_history(limit: int = Query(20, ge=1, le=100)):
    rows = query(
        """SELECT s.id, s.zone_id, z.name as zone_name, z.type as zone_type,
                  s.before_year, s.after_year, s.severity, s.change_type, s.confidence,
                  s.affected_area_ha, s.data_source, s.summary, s.created_at, s.ndvi_change
           FROM monitoring_scans s JOIN zones z ON s.zone_id = z.id
           ORDER BY s.created_at DESC LIMIT %s""",
        (limit,),
    )
    return [
        {
            "id": r["id"], "zone_id": r["zone_id"], "zone_name": r["zone_name"],
            "zone_type": r["zone_type"], "before_year": r["before_year"],
            "after_year": r["after_year"], "severity": r["severity"],
            "change_type": r["change_type"], "confidence": r["confidence"],
            "affected_area_ha": r["affected_area_ha"], "data_source": r["data_source"],
            "summary": r["summary"], "created_at": r["created_at"].isoformat(),
            "ndvi_change": r["ndvi_change"],
        }
        for r in rows
    ]


@router.post("/scan")
def run_scan(req: ScanRequest):
    provider = get_provider()
    result = provider.analyze_zone(req.zone_id, req.before_year, req.after_year)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No vegetation data for this zone/period")

    _store_scan(result)
    return result.to_dict()


@router.post("/scan-all")
def scan_all_zones(before_year: int = 2005, after_year: int = 2025):
    zones = query("SELECT id, name FROM zones WHERE type = 'reserve' AND geom IS NOT NULL")
    provider = get_provider()
    results = []
    for z in zones:
        result = provider.analyze_zone(z["id"], before_year, after_year)
        if result:
            _store_scan(result)
            results.append(result.to_dict())
    return {"scanned": len(zones), "results": results, "provider": provider.get_source_name()}


@router.get("/provider")
def get_provider_info():
    p = get_provider()
    return {"name": p.get_source_name(), "available": p.is_available()}


@router.get("/zone/{zone_id}")
def get_zone_scans(zone_id: int):
    rows = query(
        "SELECT * FROM monitoring_scans WHERE zone_id = %s ORDER BY created_at DESC LIMIT 10",
        (zone_id,),
    )
    return [
        {
            "id": r["id"], "before_year": r["before_year"], "after_year": r["after_year"],
            "severity": r["severity"], "confidence": r["confidence"],
            "ndvi_change": r["ndvi_change"], "affected_area_ha": r["affected_area_ha"],
            "data_source": r["data_source"], "summary": r["summary"], "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


def _store_scan(result: SatelliteScanResult):
    execute(
        """INSERT INTO monitoring_scans (zone_id, before_year, after_year, before_ndvi, after_ndvi,
           ndvi_change, severity, confidence, change_type, affected_area_ha, data_source, summary)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (result.zone_id, result.before_year, result.after_year, result.before_ndvi,
         result.after_ndvi, result.ndvi_change, result.severity, result.confidence,
         result.change_type, result.affected_area_ha, result.data_source, result.summary),
    )
