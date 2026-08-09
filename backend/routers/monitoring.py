"""Satellite monitoring and change detection API."""

import threading
import time
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from backend.services.database import query, execute, execute_returning
from backend.services.satellite_provider import get_provider, DemoProvider, SatelliteScanResult
from backend.middleware.auth_middleware import require_analyst

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/monitoring", tags=["monitoring"])

_scheduler_running = False
_scheduler_interval = 86400  # 24 hours


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
def run_scan(req: ScanRequest, _=Depends(require_analyst)):
    provider = get_provider()
    result = provider.analyze_zone(req.zone_id, req.before_year, req.after_year)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No vegetation data for this zone/period")

    _store_scan(result)
    return result.to_dict()


@router.post("/scan-all")
def scan_all_zones(before_year: int = 2005, after_year: int = 2025, _=Depends(require_analyst)):
    zones = query("SELECT id, name FROM zones WHERE type = 'reserve' AND geom IS NOT NULL")
    provider = get_provider()
    results = []
    for z in zones:
        result = provider.analyze_zone(z["id"], before_year, after_year)
        if result:
            _store_scan(result)
            results.append(result.to_dict())
    return {"scanned": len(zones), "results": results, "provider": provider.get_source_name()}


@router.get("/scheduler")
def scheduler_status():
    return {"running": _scheduler_running, "interval_hours": _scheduler_interval / 3600}


def start_monitoring_scheduler():
    global _scheduler_running
    if _scheduler_running:
        return
    _scheduler_running = True

    def _worker():
        while _scheduler_running:
            try:
                logger.info("Scheduled monitoring scan starting...")
                zones = query("SELECT id FROM zones WHERE type = 'reserve' AND geom IS NOT NULL")
                provider = get_provider()
                for z in zones:
                    result = provider.analyze_zone(z["id"], 2005, 2025)
                    if result:
                        _store_scan(result)
                logger.info(f"Scheduled scan completed for {len(zones)} zones")
            except Exception as e:
                logger.error(f"Scheduled scan failed: {e}")
            time.sleep(_scheduler_interval)

    threading.Thread(target=_worker, daemon=True).start()
    logger.info("Monitoring scheduler started")


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


@router.get("/encroachment/{zone_id}")
def detect_encroachment(zone_id: int, before_year: int = 2005, after_year: int = 2025):
    zone = query("SELECT name, type, area_ha FROM zones WHERE id = %s", (zone_id,))
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    provider = get_provider()
    result = provider.analyze_zone(zone_id, before_year, after_year)
    if not result:
        raise HTTPException(status_code=404, detail="No data for this zone")

    is_protected = zone[0]["type"] in ("reserve", "core_forest", "eco_sensitive")
    change = result.ndvi_change

    encroachment_risk = "none"
    risk_level = 0
    if is_protected and change < -0.02:
        if change < -0.10:
            encroachment_risk = "high"
            risk_level = 85
        elif change < -0.05:
            encroachment_risk = "medium"
            risk_level = 60
        else:
            encroachment_risk = "low"
            risk_level = 30

    return {
        "zone_id": zone_id,
        "zone_name": zone[0]["name"],
        "zone_type": zone[0]["type"],
        "is_protected": is_protected,
        "before_year": before_year,
        "after_year": after_year,
        "ndvi_change": change,
        "encroachment_risk": encroachment_risk,
        "risk_level": risk_level,
        "affected_area_ha": result.affected_area_ha,
        "confidence": result.confidence,
        "change_type": result.change_type,
        "data_source": result.data_source,
        "evidence": {
            "ndvi_decline": abs(change) > 0.02,
            "sustained_change": abs(change) > 0.05,
            "protected_zone": is_protected,
        },
        "summary": result.summary,
        "recommendation": (
            "Immediate field verification required. High-confidence vegetation loss detected within protected area boundaries."
            if encroachment_risk == "high"
            else "Field inspection recommended. Moderate vegetation change detected. Verify against permitted activities."
            if encroachment_risk == "medium"
            else "Monitor for further change. Minor vegetation variation within normal range."
            if encroachment_risk == "low"
            else "No encroachment indicators detected. Vegetation within expected parameters."
        ),
    }


def _store_scan(result: SatelliteScanResult):
    execute(
        """INSERT INTO monitoring_scans (zone_id, before_year, after_year, before_ndvi, after_ndvi,
           ndvi_change, severity, confidence, change_type, affected_area_ha, data_source, summary)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (result.zone_id, result.before_year, result.after_year, result.before_ndvi,
         result.after_ndvi, result.ndvi_change, result.severity, result.confidence,
         result.change_type, result.affected_area_ha, result.data_source, result.summary),
    )
