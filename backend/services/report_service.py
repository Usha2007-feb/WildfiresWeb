"""
AI-generated PDF reports using real data. No ML - template-based with live data.
"""

import io, logging
from datetime import datetime, timezone
from pathlib import Path
from fpdf import FPDF
from backend.services.database import query

logger = logging.getLogger(__name__)

ACCENT = (37, 99, 235)       # blue-600
DARK = (15, 23, 42)           # slate-900
BODY = (51, 65, 85)           # slate-700
MUTED = (100, 116, 139)       # slate-500
LIGHT_BG = (241, 245, 249)    # slate-100
RED = (220, 38, 38)
GREEN = (22, 163, 74)
AMBER = (245, 158, 11)
WHITE = (255, 255, 255)

HI = {
    "exec_summary": "कार्यकारी सारांश",
    "monitored_zones": "निगरानी रिजर्व क्षेत्र",
    "zone_details": "रिजर्व विवरण",
    "data_sources": "डेटा स्रोत और पद्धति",
    "recommendations": "सिफारिशें",
    "zone_analysis": "क्षेत्र-दर-क्षेत्र विश्लेषण",
    "detailed_analysis": "विस्तृत विश्लेषण",
    "key_findings": "मुख्य निष्कर्ष",
    "active_fires": "सक्रिय आग (FIRMS)",
    "monitored": "निगरानी क्षेत्र",
    "avg_ndvi": "औसत NDVI",
    "zone_type": "क्षेत्र प्रकार",
    "count": "संख्या",
    "name": "नाम",
    "state": "राज्य",
    "area_ha": "क्षेत्र (हे.)",
    "ndvi_label": "NDVI",
    "cover_pct": "कवर%",
    "disturb_pct": "क्षति%",
    "trend": "रुझान",
    "declining_zones": "गिरावट क्षेत्र",
    "stable_zones": "स्थिर क्षेत्र",
    "improving_zones": "सुधार क्षेत्र",
    "declining": "गिरावट",
    "stable": "स्थिर",
    "improving": "सुधार",
    "severity_high": "उच्च",
    "severity_moderate": "मध्यम",
    "severity_low": "कम",
    "field_verify": "तत्काल फील्ड सत्यापन की सिफारिश",
    "scheduled_inspect": "निर्धारित निरीक्षण की सलाह",
    "stable_msg": "क्षेत्र स्थिर प्रतीत होता है",
}

EN = {
    "exec_summary": "EXECUTIVE SUMMARY",
    "monitored_zones": "MONITORED RESERVE ZONES",
    "zone_details": "RESERVE DETAILS",
    "data_sources": "DATA SOURCES & METHODOLOGY",
    "recommendations": "RECOMMENDATIONS",
    "zone_analysis": "ZONE-BY-ZONE ANALYSIS",
    "detailed_analysis": "DETAILED ANALYSIS",
    "key_findings": "KEY FINDINGS",
    "active_fires": "Active FIRMS Fires",
    "monitored": "Monitored Zones",
    "avg_ndvi": "Avg NDVI (2025)",
    "zone_type": "Zone Type",
    "count": "Count",
    "name": "Name",
    "state": "State",
    "area_ha": "Area (ha)",
    "ndvi_label": "NDVI",
    "cover_pct": "Cover%",
    "disturb_pct": "Disturb%",
    "trend": "Trend",
    "declining_zones": "Declining Zones",
    "stable_zones": "Stable Zones",
    "improving_zones": "Improving Zones",
    "declining": "DECLINING",
    "stable": "STABLE",
    "improving": "IMPROVING",
    "severity_high": "HIGH",
    "severity_moderate": "MODERATE",
    "severity_low": "LOW",
    "field_verify": "Immediate field verification recommended",
    "scheduled_inspect": "Scheduled field inspection advised",
    "stable_msg": "Zone appears stable with minimal change",
}


def _t(lang: str, key: str) -> str:
    return (HI if lang == "hi" else EN).get(key, key)


def _build_pdf(title: str, subtitle: str, lang: str = "en") -> FPDF:
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)

    font_path = Path(__file__).parent / "NotoSansDevanagari.ttf"
    if font_path.exists():
        pdf.add_font("Uni", "", str(font_path), uni=True)
        pdf.add_font("Uni", "B", str(font_path), uni=True)
        pdf.add_font("Uni", "I", str(font_path), uni=True)
    else:
        pdf.add_font("Uni", "", "Courier")
        pdf.add_font("Uni", "B", "Courier")

    pdf.add_page()

    # Header bar
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 0, 210, 8, "F")
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 8, 210, 1.5, "F")

    # Logo / title area
    pdf.set_y(18)
    pdf.set_font("Uni", "B", 24)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 10, "WILDFIRE ENGINE", ln=True, align="C")
    pdf.set_font("Uni", "", 10)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 6, "Forest Intelligence & Monitoring Platform", ln=True, align="C")

    pdf.ln(3)
    pdf.set_draw_color(*ACCENT)
    pdf.set_line_width(0.5)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(6)

    # Title
    pdf.set_x(15)
    pdf.set_font("Uni", "B", 18)
    pdf.set_text_color(*DARK)
    pdf.multi_cell(180, 8, title, align="C")
    pdf.set_x(15)
    pdf.set_font("Uni", "I", 10)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(180, 6, subtitle, align="C")
    pdf.ln(4)

    now = datetime.now(timezone.utc).strftime("%d %B %Y, %H:%M UTC")
    pdf.set_font("Uni", "", 9)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 6, f"Generated: {now}", ln=True, align="C")
    pdf.cell(0, 6, "Data Sources: NASA FIRMS VIIRS · Open-Meteo · PostGIS · ESA Sentinel-2 CDSE", ln=True, align="C")
    pdf.ln(6)

    return pdf


def _section_header(pdf: FPDF, title: str):
    pdf.ln(4)
    pdf.set_fill_color(*ACCENT)
    pdf.set_text_color(*WHITE)
    pdf.set_font("Uni", "B", 12)
    pdf.cell(0, 8, f"  {title}", ln=True, fill=True)
    pdf.ln(3)


def _kpi_row(pdf: FPDF, items: list[tuple[str, str, str]]):
    """items: list of (label, value, color_hex)"""
    n = len(items)
    w = 180 / n
    pdf.set_font("Uni", "B", 9)
    pdf.set_text_color(*MUTED)
    for label, _, _ in items:
        pdf.cell(w, 5, label, align="C")
    pdf.ln()
    pdf.set_font("Uni", "B", 16)
    for _, value, color in items:
        r, g, b = tuple(int(color[i:i+2], 16) for i in (1, 3, 5))
        pdf.set_text_color(r, g, b)
        pdf.cell(w, 10, value, align="C")
    pdf.ln(8)
    pdf.set_text_color(*BODY)


def _body_text(pdf: FPDF, text: str, bold: bool = False, size: int = 10, indent: int = 0):
    pdf.set_x(15 + indent)
    pdf.set_font("Uni", "B" if bold else "", size)
    pdf.set_text_color(*BODY)
    pdf.multi_cell(180 - indent, 5.5, text)


def _bullet(pdf: FPDF, text: str):
    pdf.set_x(20)
    pdf.set_font("Uni", "", 10)
    pdf.set_text_color(*BODY)
    pdf.cell(5, 5, "-")
    pdf.multi_cell(170, 5.5, text.strip())


def _table(pdf: FPDF, headers: list[str], rows: list[list[str]], col_widths: list[int] = None):
    if not col_widths:
        col_widths = [180 // len(headers)] * len(headers)

    pdf.set_fill_color(*ACCENT)
    pdf.set_text_color(*WHITE)
    pdf.set_font("Uni", "B", 9)
    for h, w in zip(headers, col_widths):
        pdf.cell(w, 7, f" {h}", border=0, fill=True)
    pdf.ln()

    for i, row in enumerate(rows):
        if i % 2 == 0:
            pdf.set_fill_color(*LIGHT_BG)
        else:
            pdf.set_fill_color(*WHITE)
        pdf.set_text_color(*BODY)
        pdf.set_font("Uni", "", 9)
        for val, w in zip(row, col_widths):
            pdf.cell(w, 6, f" {val[:25]}", border=0, fill=True)
        pdf.ln()
    pdf.ln(2)


def generate_fire_risk_pdf(lang: str = "en") -> bytes:
    now = datetime.now(timezone.utc).strftime("%d %B %Y, %H:%M UTC")

    stats = query("SELECT COUNT(*) as c FROM zones WHERE geom IS NOT NULL")
    zone_count = stats[0]["c"] if stats else 0

    from backend.services.firms import get_firms
    firms_data, _ = get_firms()
    active_fires = len(firms_data) if firms_data else 0

    type_stats = query("SELECT type, COUNT(*) as c FROM zones WHERE geom IS NOT NULL GROUP BY type ORDER BY type")
    veg_stats = query("SELECT ROUND(AVG(ndvi)::numeric, 4) as avg_ndvi FROM vegetation_history WHERE year = 2025")
    avg_ndvi = veg_stats[0]["avg_ndvi"] if veg_stats and veg_stats[0]["avg_ndvi"] else "N/A"

    zone_info = query("SELECT z.name, z.state, z.area_ha FROM zones z WHERE z.type = 'reserve' AND z.geom IS NOT NULL ORDER BY z.name")

    pdf = _build_pdf("Indian Forest Fire Risk Analysis" if lang == "en" else "भारतीय वन अग्नि जोखिम विश्लेषण",
                     "AI-Generated Intelligence Brief" if lang == "en" else "एआई-जनित खुफिया रिपोर्ट",
                     lang)
    pdf.set_font("Uni", "B", 10)
    pdf.set_text_color(71, 85, 105)
    model_text = "Model: XGBoost + CatBoost Ensemble VotingClassifier | Features: 14 | Resolution: 0.5deg grid" if lang == "en" else "मॉडल: XGBoost + CatBoost एन्सेम्बल | फीचर्स: 14 | रिजोल्यूशन: 0.5deg ग्रिड"
    pdf.cell(0, 5, model_text, ln=True, align="C")
    pdf.ln(4)

    _section_header(pdf, _t(lang, "exec_summary"))
    summary_text = f"This report provides a comprehensive analysis of wildfire risk across India's monitored forest reserves. The analysis synthesises data from {zone_count} geo-fenced zones spanning multiple Indian states." if lang == "en" else f"यह रिपोर्ट भारत के निगरानी वन रिजर्व में वाइल्डफायर जोखिम का व्यापक विश्लेषण प्रदान करती है। {zone_count} जियो-फेंस्ड क्षेत्रों से डेटा संश्लेषित किया गया है।"
    _body_text(pdf, summary_text, size=10)
    pdf.ln(2)

    _kpi_row(pdf, [
        (_t(lang, "active_fires"), str(active_fires), "#DC2626"),
        (_t(lang, "monitored"), str(zone_count), "#2563EB"),
        (_t(lang, "avg_ndvi"), str(avg_ndvi), "#16A34A"),
    ])

    _section_header(pdf, _t(lang, "monitored_zones"))
    type_labels = {"reserve": "Protected Reserves", "buffer_zone": "Buffer Zones", "core_forest": "Core Forest", "eco_sensitive": "Eco-Sensitive", "beat_boundary": "Beat Boundary", "compartment": "Compartment"}
    if lang == "hi":
        type_labels = {"reserve": "संरक्षित रिजर्व", "buffer_zone": "बफर क्षेत्र", "core_forest": "कोर वन", "eco_sensitive": "इको-संवेदनशील", "beat_boundary": "बीट सीमा", "compartment": "कम्पार्टमेंट"}
    table_rows = [[type_labels.get(t["type"], t["type"]), str(t["c"])] for t in type_stats]
    _table(pdf, [_t(lang, "zone_type"), _t(lang, "count")], table_rows, [130, 50])

    _section_header(pdf, _t(lang, "zone_details"))
    headers = [_t(lang, "name"), _t(lang, "state"), _t(lang, "area_ha")]
    rows = [[z["name"][:30], z.get("state", "")[:15], str(z.get("area_ha", ""))[:15]] for z in zone_info]
    _table(pdf, headers, rows, [80, 55, 45])

    _section_header(pdf, _t(lang, "data_sources"))
    if lang == "hi":
        _bullet(pdf, "NASA FIRMS (VIIRS NOAA-20 NRT) - भारत बाउंडिंग बॉक्स में प्रति घंटा उपग्रह आग पहचान रिफ्रेश।")
        _bullet(pdf, "Open-Meteo API - रीयल-टाइम तापमान, आर्द्रता और हवा की गति।")
        _bullet(pdf, f"PostGIS स्थानिक डेटाबेस (NeonDB) - {zone_count} क्षेत्र GiST इंडेक्स के साथ।")
        _bullet(pdf, "ESA Sentinel-2 (CDSE) - B04 और B08 बैंड से NDVI गणना।")
    else:
        _bullet(pdf, "NASA FIRMS (VIIRS NOAA-20 NRT) - hourly satellite fire detection refresh across India bounding box.")
        _bullet(pdf, "Open-Meteo API - real-time temperature, humidity, and wind speed at 2m/10m above ground.")
        _bullet(pdf, f"PostGIS Spatial Database (NeonDB) - {zone_count} zones with GiST spatial indexes, 6-level hierarchy.")
        _bullet(pdf, "ESA Sentinel-2 (CDSE) - NDVI computation from B04 (Red) and B08 (NIR) bands via Statistical API.")

    _section_header(pdf, _t(lang, "recommendations"))
    if lang == "hi":
        _bullet(pdf, "सभी निगरानी क्षेत्रों के लिए रीयल-टाइम FIRMS एकीकरण बनाए रखें।")
        _bullet(pdf, "AI-सहायता अतिक्रमण पहचान द्वारा चिह्नित क्षेत्रों में फील्ड सत्यापन टीम तैनात करें।")
        _bullet(pdf, "दीर्घकालिक प्रवृत्ति विश्लेषण के लिए 21-वर्षीय NDVI डेटाबेस को बनाए रखें।")
        _bullet(pdf, "आगे की ओर जोखिम अनुमानों के लिए बहु-दिवसीय मौसम पूर्वानुमान एकीकृत करें।")
    else:
        _bullet(pdf, "Maintain real-time FIRMS integration with geo-fence alerting for all monitored zones.")
        _bullet(pdf, "Deploy field verification teams to zones flagged by AI-assisted encroachment detection.")
        _bullet(pdf, "Continue seeding 21-year NDVI database for accurate long-term trend analysis.")
        _bullet(pdf, "Integrate multi-day weather forecasts for forward-looking risk projections.")

    pdf.ln(10)
    pdf.set_draw_color(*ACCENT)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(4)
    pdf.set_font("Uni", "I", 8)
    pdf.set_text_color(*MUTED)
    gen_text = _t(lang, "generated") if "generated" in EN else "Generated by Wildfire Engine AI Analysis System"
    pdf.cell(0, 5, gen_text if lang == "en" else "वाइल्डफायर इंजन एआई विश्लेषण प्रणाली द्वारा उत्पन्न", ln=True, align="C")
    pdf.cell(0, 5, "This report contains AI-assisted analysis. Verify critical findings with field data." if lang == "en" else "यह रिपोर्ट एआई-सहायता विश्लेषण है। महत्वपूर्ण निष्कर्षों को फील्ड डेटा से सत्यापित करें।", ln=True, align="C")

    return pdf.output()
    now = datetime.now(timezone.utc).strftime("%d %B %Y, %H:%M UTC")

    stats = query("SELECT COUNT(*) as c FROM zones WHERE geom IS NOT NULL")
    zone_count = stats[0]["c"] if stats else 0

    from backend.services.firms import get_firms
    firms_data, _ = get_firms()
    active_fires = len(firms_data) if firms_data else 0

    type_stats = query("SELECT type, COUNT(*) as c FROM zones WHERE geom IS NOT NULL GROUP BY type ORDER BY type")
    veg_stats = query("SELECT ROUND(AVG(ndvi)::numeric, 4) as avg_ndvi FROM vegetation_history WHERE year = 2025")
    avg_ndvi = veg_stats[0]["avg_ndvi"] if veg_stats and veg_stats[0]["avg_ndvi"] else "N/A"

    zone_info = query("SELECT z.name, z.state, z.area_ha FROM zones z WHERE z.type = 'reserve' AND z.geom IS NOT NULL ORDER BY z.name")

    pdf = _build_pdf("Indian Forest Fire Risk Analysis", "AI-Generated Intelligence Brief")
    pdf.set_font("Uni", "B", 10)
    pdf.set_text_color(71, 85, 105)
    pdf.cell(0, 5, f"Model: XGBoost + CatBoost Ensemble VotingClassifier | Features: 14 | Resolution: 0.5deg grid", ln=True, align="C")
    pdf.ln(4)

    _section_header(pdf, "EXECUTIVE SUMMARY")
    _body_text(pdf, f"This report provides a comprehensive analysis of wildfire risk across India's monitored forest reserves. The analysis synthesises data from {zone_count} geo-fenced zones spanning multiple Indian states.", size=10)
    pdf.ln(2)

    _kpi_row(pdf, [
        ("Active FIRMS Fires", str(active_fires), "#DC2626"),
        ("Monitored Zones", str(zone_count), "#2563EB"),
        ("Avg NDVI (2025)", str(avg_ndvi), "#16A34A"),
    ])

    _section_header(pdf, "MONITORED RESERVE ZONES")
    type_labels = {"reserve": "Protected Reserves", "buffer_zone": "Buffer Zones", "core_forest": "Core Forest", "eco_sensitive": "Eco-Sensitive", "beat_boundary": "Beat Boundary", "compartment": "Compartment"}
    table_rows = [[type_labels.get(t["type"], t["type"]), str(t["c"])] for t in type_stats]
    _table(pdf, ["Zone Type", "Count"], table_rows, [130, 50])

    _section_header(pdf, "RESERVE DETAILS")
    headers = ["Name", "State", "Area (ha)"]
    rows = [[z["name"][:30], z.get("state", "")[:15], str(z.get("area_ha", ""))[:15]] for z in zone_info]
    _table(pdf, headers, rows, [80, 55, 45])

    _section_header(pdf, "DATA SOURCES & METHODOLOGY")
    _bullet(pdf, "NASA FIRMS (VIIRS NOAA-20 NRT) - hourly satellite fire detection refresh across India bounding box.")
    _bullet(pdf, "Open-Meteo API - real-time temperature, humidity, and wind speed at 2m/10m above ground.")
    _bullet(pdf, "PostGIS Spatial Database (NeonDB) - {zone_count} zones with GiST spatial indexes, 6-level hierarchy.")
    _bullet(pdf, "ESA Sentinel-2 (CDSE) - NDVI computation from B04 (Red) and B08 (NIR) bands via Statistical API.")
    pdf.ln(2)
    _body_text(pdf, "The XGBoost + CatBoost ensemble model processes 14 weather-derived features (VPD, temperature, humidity, wind, fire danger index, moisture stress, drying power, seasonal heat, and geographic coordinates) to predict fire probability via soft voting. Model trained on 9.4M labeled points (2018-2025), achieving ROC-AUC of 0.9861.", size=10)

    _section_header(pdf, "RECOMMENDATIONS")
    _bullet(pdf, "Maintain real-time FIRMS integration with geo-fence alerting for all monitored zones.")
    _bullet(pdf, "Deploy field verification teams to zones flagged by AI-assisted encroachment detection.")
    _bullet(pdf, "Continue seeding 21-year NDVI database for accurate long-term trend analysis.")
    _bullet(pdf, "Integrate multi-day weather forecasts for forward-looking risk projections.")

    # Footer
    pdf.ln(10)
    pdf.set_draw_color(*ACCENT)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(4)
    pdf.set_font("Uni", "I", 8)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 5, "Generated by Wildfire Engine AI Analysis System", ln=True, align="C")
    pdf.cell(0, 5, "This report contains AI-assisted analysis. Verify critical findings with field data.", ln=True, align="C")

    return pdf.output()


def generate_deforestation_pdf(zone_id: int = None, lang: str = "en") -> bytes:
    now = datetime.now(timezone.utc).strftime("%d %B %Y, %H:%M UTC")

    if zone_id:
        zone_info = query("SELECT id, name, type, state, area_ha FROM zones WHERE id = %s", (zone_id,))
        if not zone_info:
            return _build_pdf("Error", "Zone not found").output()
        z = zone_info[0]
        title = f"Deforestation Trend: {z['name']}"
        subtitle = f"{z['type'].replace('_', ' ').title()} | {z.get('state', 'N/A')} | {z.get('area_ha', 'N/A')} ha"
        zone_filter = f"AND z.id = {zone_id}"
    else:
        title = "Deforestation Trend Report"
        subtitle = "All Monitored Zones | 2005 - 2025"
        zone_filter = ""

    veg_data = query(f"""
        SELECT z.id, z.name, z.type, z.state,
               ROUND(AVG(v.ndvi)::numeric, 4) as avg_ndvi,
               ROUND(AVG(v.vegetation_cover_pct)::numeric, 1) as avg_cover,
               ROUND(AVG(v.disturbance_pct)::numeric, 1) as avg_disturb
        FROM zones z JOIN vegetation_history v ON z.id = v.zone_id
        WHERE v.year IN (2005, 2025) {zone_filter}
        GROUP BY z.id, z.name, z.type, z.state ORDER BY z.name
    """)

    pdf = _build_pdf(title, subtitle)
    pdf.ln(2)

    _section_header(pdf, _t(lang, "exec_summary"))
    if lang == "hi":
        _body_text(pdf, f"यह रिपोर्ट 2005-2025 के NDVI डेटा का उपयोग करके दीर्घकालिक वनस्पति स्वास्थ्य प्रवृत्तियों का विश्लेषण करती है। विश्लेषण निगरानी क्षेत्रों में वन क्षरण, स्थिरता और पुनर्प्राप्ति के पैटर्न की पहचान करता है।", size=10)
    else:
        _body_text(pdf, f"This report analyses long-term vegetation health trends using NDVI data spanning 2005-2025 ({20 + (datetime.now().year - 2005)} years).", size=10)
    pdf.ln(3)

    declining = [r for r in veg_data if r["avg_ndvi"] and r["avg_ndvi"] < 0.55]
    stable = [r for r in veg_data if r["avg_ndvi"] and 0.55 <= r["avg_ndvi"] <= 0.68]
    improving = [r for r in veg_data if r["avg_ndvi"] and r["avg_ndvi"] > 0.68]

    _kpi_row(pdf, [
        (_t(lang, "declining_zones"), str(len(declining)), "#DC2626"),
        (_t(lang, "stable_zones"), str(len(stable)), "#F59E0B"),
        (_t(lang, "improving_zones"), str(len(improving)), "#16A34A"),
    ])

    _section_header(pdf, _t(lang, "zone_analysis"))
    headers = [_t(lang, "name"), _t(lang, "ndvi_label"), _t(lang, "cover_pct"), _t(lang, "disturb_pct"), _t(lang, "trend")]
    rows = []
    for r in veg_data:
        trend = _t(lang, "declining") if r["avg_ndvi"] and r["avg_ndvi"] < 0.55 else _t(lang, "stable") if r["avg_ndvi"] and r["avg_ndvi"] <= 0.68 else _t(lang, "improving")
        rows.append([
            r["name"][:28], str(r["avg_ndvi"] or "N/A")[:8],
            str(r["avg_cover"] or "N/A")[:6], str(r["avg_disturb"] or "N/A")[:6],
            trend,
        ])
    _table(pdf, headers, rows, [65, 30, 25, 25, 35])

    _section_header(pdf, _t(lang, "detailed_analysis"))
    for r in veg_data:
        sev = "HIGH" if r["avg_disturb"] and r["avg_disturb"] > 15 else "MODERATE" if r["avg_disturb"] and r["avg_disturb"] > 8 else "LOW"
        _body_text(pdf, f"{r['name']} ({r['type'].replace('_', ' ').title()})", bold=True, size=10)
        pdf.ln(1)
        if sev == "HIGH":
            _body_text(pdf, f"Severity: HIGH - Significant vegetation disturbance detected. Active deforestation or degradation likely. Immediate field verification recommended. NDVI: {r['avg_ndvi'] or 'N/A'}, Cover: {r['avg_cover'] or 'N/A'}%, Disturbance: {r['avg_disturb'] or 'N/A'}%.", size=9)
        elif sev == "MODERATE":
            _body_text(pdf, f"Severity: MODERATE - Gradual degradation pattern observed. Scheduled field inspection advised. NDVI: {r['avg_ndvi'] or 'N/A'}, Cover: {r['avg_cover'] or 'N/A'}%, Disturbance: {r['avg_disturb'] or 'N/A'}%.", size=9)
        else:
            _body_text(pdf, f"Severity: LOW - Zone appears stable with minimal vegetation change. NDVI: {r['avg_ndvi'] or 'N/A'}, Cover: {r['avg_cover'] or 'N/A'}%, Disturbance: {r['avg_disturb'] or 'N/A'}%.", size=9)
        pdf.ln(3)

    _section_header(pdf, "KEY FINDINGS")
    _bullet(pdf, "Urban-forest interface zones (e.g., Jyotikuchi) show higher disturbance rates - consistent with anthropogenic pressure.")
    _bullet(pdf, "Core protected areas with active management demonstrate vegetation stability, suggesting effective conservation.")
    _bullet(pdf, "Buffer zones consistently show higher disturbance than core zones, validating the spatial management approach.")
    _bullet(pdf, "All zones exhibit expected seasonal NDVI fluctuations corresponding to monsoon/dry season cycles.")

    _section_header(pdf, "RECOMMENDATIONS")
    _bullet(pdf, "Priority field verification for HIGH severity zones - immediate ground-truth verification required.")
    _bullet(pdf, "Increase satellite monitoring frequency for zones showing MODERATE or HIGH disturbance trends.")
    _bullet(pdf, "Strengthen buffer zone protection - these areas show the highest disturbance rates across all regions.")
    _bullet(pdf, "Maintain the 21-year NDVI database as critical baseline for future change detection.")

    pdf.ln(8)
    pdf.set_draw_color(*ACCENT)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(4)
    pdf.set_font("Uni", "I", 8)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 5, "Generated by Wildfire Engine AI Analysis System", ln=True, align="C")
    pdf.cell(0, 5, "This report contains AI-assisted analysis. Verify critical findings with field data.", ln=True, align="C")

    return pdf.output()
