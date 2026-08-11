"""AI Report download endpoints."""

from fastapi import APIRouter, Query
from fastapi.responses import Response
from backend.services.report_service import generate_fire_risk_report, generate_deforestation_report

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


@router.get("/fire-risk")
def download_fire_risk_report():
    report = generate_fire_risk_report()
    return Response(
        content=report,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=india_fire_risk_analysis.txt"},
    )


@router.get("/deforestation")
def download_deforestation_report(zone_id: int = Query(None)):
    report = generate_deforestation_report(zone_id)
    return Response(
        content=report,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=deforestation_trend_report.txt"},
    )
