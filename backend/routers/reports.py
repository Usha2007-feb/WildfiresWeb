"""AI Report download endpoints."""

from fastapi import APIRouter, Query
from fastapi.responses import Response
from backend.services.report_service import generate_fire_risk_pdf, generate_deforestation_pdf

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


@router.get("/fire-risk")
def download_fire_risk_report(lang: str = Query("en")):
    pdf = generate_fire_risk_pdf(lang=lang)
    filename = "bharat_van_agni_vishleshan.pdf" if lang == "hi" else "india_fire_risk_analysis.pdf"
    return Response(
        content=bytes(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/deforestation")
def download_deforestation_report(zone_id: int = Query(None), lang: str = Query("en")):
    pdf = generate_deforestation_pdf(zone_id, lang=lang)
    filename = "van_katayi_riport.pdf" if lang == "hi" else "deforestation_trend_report.pdf"
    return Response(
        content=bytes(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
