"""AI Report download endpoints."""

from fastapi import APIRouter, Query
from fastapi.responses import Response
from backend.services.report_service import generate_fire_risk_pdf, generate_deforestation_pdf

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


@router.get("/fire-risk")
def download_fire_risk_report():
    pdf = generate_fire_risk_pdf()
    return Response(
        content=bytes(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=india_fire_risk_analysis.pdf"},
    )


@router.get("/deforestation")
def download_deforestation_report(zone_id: int = Query(None)):
    pdf = generate_deforestation_pdf(zone_id)
    return Response(
        content=bytes(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=deforestation_trend_report.pdf"},
    )
