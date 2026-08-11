"""
Satellite data provider abstraction with demo and Sentinel Hub implementations.
"""

import json, os, logging, math, random, hashlib
from datetime import datetime, timezone
from pathlib import Path
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)

NDVI_THRESHOLDS = {
    "dense": (0.6, 1.0),
    "moderate": (0.3, 0.6),
    "sparse": (0.1, 0.3),
    "bare": (-0.1, 0.1),
    "water": (-1.0, -0.1),
}

CHANGE_THRESHOLDS = {
    "critical": 0.20,
    "significant": 0.10,
    "moderate": 0.05,
    "minor": 0.02,
}


class SatelliteScanResult:
    def __init__(self):
        self.zone_id: int = 0
        self.zone_name: str = ""
        self.before_year: int = 0
        self.after_year: int = 0
        self.before_ndvi: float = 0.0
        self.after_ndvi: float = 0.0
        self.ndvi_change: float = 0.0
        self.change_pct: float = 0.0
        self.affected_area_ha: float = 0.0
        self.severity: str = "none"
        self.confidence: float = 0.0
        self.change_type: str = "stable"
        self.detected_at: str = ""
        self.data_source: str = "demo"
        self.change_polygons: list = []
        self.summary: str = ""

    def to_dict(self):
        return {
            "zone_id": self.zone_id, "zone_name": self.zone_name,
            "before_year": self.before_year, "after_year": self.after_year,
            "before_ndvi": round(self.before_ndvi, 4), "after_ndvi": round(self.after_ndvi, 4),
            "ndvi_change": round(self.ndvi_change, 4),
            "change_pct": round(self.change_pct, 1),
            "affected_area_ha": round(self.affected_area_ha, 1),
            "severity": self.severity, "confidence": round(self.confidence, 2),
            "change_type": self.change_type, "detected_at": self.detected_at,
            "data_source": self.data_source,
            "change_polygons": self.change_polygons,
            "summary": self.summary,
        }


class SatelliteProvider(ABC):
    @abstractmethod
    def get_source_name(self) -> str:
        pass

    @abstractmethod
    def analyze_zone(self, zone_id: int, before_year: int, after_year: int) -> SatelliteScanResult | None:
        pass

    @abstractmethod
    def is_available(self) -> bool:
        pass


class DemoProvider(SatelliteProvider):
    def get_source_name(self):
        return "Demo (Modeled Vegetation Data)"

    def is_available(self):
        return True

    def analyze_zone(self, zone_id: int, before_year: int = 2005, after_year: int = 2025) -> SatelliteScanResult:
        from backend.services.database import query

        rows = query(
            "SELECT AVG(ndvi) as avg_ndvi, AVG(vegetation_cover_pct) as avg_cover FROM vegetation_history WHERE zone_id = %s AND year = %s",
            (zone_id, before_year),
        )
        before_ndvi = rows[0]["avg_ndvi"] if rows and rows[0]["avg_ndvi"] else None
        before_cover = rows[0]["avg_cover"] if rows and rows[0]["avg_cover"] else None

        rows = query(
            "SELECT AVG(ndvi) as avg_ndvi, AVG(vegetation_cover_pct) as avg_cover FROM vegetation_history WHERE zone_id = %s AND year = %s",
            (zone_id, after_year),
        )
        after_ndvi = rows[0]["avg_ndvi"] if rows and rows[0]["avg_ndvi"] else None
        after_cover = rows[0]["avg_cover"] if rows and rows[0]["avg_cover"] else None

        if before_ndvi is None or after_ndvi is None:
            return None

        zone_info = query("SELECT name, area_ha FROM zones WHERE id = %s", (zone_id,))
        zone_name = zone_info[0]["name"] if zone_info else "Unknown"
        area_ha = zone_info[0]["area_ha"] if zone_info else 1000

        change = after_ndvi - before_ndvi
        cover_loss = (before_cover or 50) - (after_cover or 50)

        severity = "none"
        if abs(change) >= CHANGE_THRESHOLDS["critical"]:
            severity = "critical"
        elif abs(change) >= CHANGE_THRESHOLDS["significant"]:
            severity = "significant"
        elif abs(change) >= CHANGE_THRESHOLDS["moderate"]:
            severity = "moderate"
        elif abs(change) >= CHANGE_THRESHOLDS["minor"]:
            severity = "minor"

        if change < -0.02:
            change_type = "declining"
        elif change > 0.02:
            change_type = "improving"
        else:
            change_type = "stable"

        confidence = min(0.95, max(0.5, 0.7 + abs(change) * 10))

        affected_ha = abs(cover_loss) * (area_ha or 1000) / 100 if cover_loss else 0

        sample_polygons = []
        if severity in ("critical", "significant"):
            sample_polygons = _generate_sample_polygons(zone_id, area_ha, affected_ha)

        summary = _build_summary(zone_name, change, cover_loss, severity, before_year, after_year)

        result = SatelliteScanResult()
        result.zone_id = zone_id
        result.zone_name = zone_name
        result.before_year = before_year
        result.after_year = after_year
        result.before_ndvi = before_ndvi
        result.after_ndvi = after_ndvi
        result.ndvi_change = change
        result.change_pct = change * 100
        result.affected_area_ha = affected_ha
        result.severity = severity
        result.confidence = confidence
        result.change_type = change_type
        result.detected_at = datetime.now(timezone.utc).isoformat()
        result.data_source = "demo"
        result.change_polygons = sample_polygons
        result.summary = summary
        return result


class SentinelHubProvider(SatelliteProvider):
    TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
    STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics"

    def __init__(self):
        self.client_id = os.environ.get("SENTINEL_HUB_CLIENT_ID", "")
        self.client_secret = os.environ.get("SENTINEL_HUB_CLIENT_SECRET", "")
        self._token = None
        self._token_expiry = 0

    def get_source_name(self):
        return "Sentinel-2 (ESA Copernicus CDSE)"

    def is_available(self):
        if not (self.client_id and self.client_secret):
            logger.info("Sentinel Hub: credentials not configured")
            return False
        logger.info(f"Sentinel Hub client ID configured: {bool(self.client_id)}")
        logger.info(f"Sentinel Hub client secret configured: {bool(self.client_secret)}")
        logger.info(f"Sentinel Hub token URL: {self.TOKEN_URL}")
        token = self._get_token()
        return token is not None

    def _get_token(self) -> str | None:
        import time
        now = time.time()
        if self._token and now < self._token_expiry - 60:
            return self._token

        try:
            import requests
            r = requests.post(
                self.TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=15,
            )
            if r.status_code == 200:
                data = r.json()
                self._token = data["access_token"]
                self._token_expiry = now + data.get("expires_in", 3600)
                logger.info("Sentinel Hub (CDSE) authenticated successfully")
                return self._token
            logger.warning(f"Sentinel Hub auth failed: {r.status_code} — check SENTINEL_HUB_CLIENT_ID and SENTINEL_HUB_CLIENT_SECRET")
        except Exception as e:
            logger.warning(f"Sentinel Hub auth error: {e}")
        return None

    def _fetch_ndvi_stats(self, geojson: str, year: int) -> float | None:
        token = self._get_token()
        if not token:
            return None

        try:
            import requests
            body = {
                "input": {
                    "bounds": {"geometry": json.loads(geojson)},
                    "data": [
                        {
                            "type": "sentinel-2-l2a",
                            "dataFilter": {
                                "timeRange": {
                                    "from": f"{year}-01-01T00:00:00Z",
                                    "to": f"{year}-12-31T23:59:59Z",
                                },
                                "maxCloudCoverage": 30,
                            },
                        }
                    ],
                },
                "aggregation": {
                    "timeRange": {
                        "from": f"{year}-01-01T00:00:00Z",
                        "to": f"{year}-12-31T23:59:59Z",
                    },
                    "aggregationInterval": {"of": "P1Y"},
                    "evalscript": "//VERSION=3\nfunction setup(){return{input:['B04','B08'],output:{bands:1}}}\nfunction evaluatePixel(s){return[(s.B08-s.B04)/(s.B08+s.B04)]}",
                    "resx": 20,
                    "resy": 20,
                },
                "calculations": {"default": {"statistics": {"default": {"percentiles": {"k": [50]}}}}},
            }

            r = requests.post(
                self.STATS_URL,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=body,
                timeout=30,
            )
            if r.status_code == 200:
                data = r.json()
                stats = data.get("data", [])
                if stats and stats[0].get("outputs", {}).get("default", {}).get("bands", {}).get("B0", {}).get("stats", {}).get("default", {}).get("percentiles", {}).get("50"):
                    ndvi = stats[0]["outputs"]["default"]["bands"]["B0"]["stats"]["default"]["percentiles"]["50"]
                    if ndvi is not None:
                        return float(ndvi)
            logger.warning(f"Sentinel Hub stats failed for {year}: {r.status_code}")
        except Exception as e:
            logger.warning(f"Sentinel Hub API error: {e}")
        return None

    def analyze_zone(self, zone_id: int, before_year: int = 2005, after_year: int = 2025) -> SatelliteScanResult | None:
        from backend.services.database import query

        rows = query("SELECT name, ST_AsGeoJSON(geom) as geojson, area_ha FROM zones WHERE id = %s AND geom IS NOT NULL", (zone_id,))
        if not rows:
            return None

        zone_name = rows[0]["name"]
        geojson = rows[0]["geojson"]
        area_ha = rows[0]["area_ha"] or 1000

        before_ndvi = self._fetch_ndvi_stats(geojson, before_year)
        after_ndvi = self._fetch_ndvi_stats(geojson, after_year)

        if before_ndvi is None or after_ndvi is None:
            logger.info(f"Sentinel Hub data unavailable for {zone_name}, falling back to demo")
            return DemoProvider().analyze_zone(zone_id, before_year, after_year)

        change = after_ndvi - before_ndvi

        severity = "none"
        for sev, threshold in [("critical", 0.20), ("significant", 0.10), ("moderate", 0.05), ("minor", 0.02)]:
            if abs(change) >= threshold:
                severity = sev
                break

        change_type = "declining" if change < -0.02 else "improving" if change > 0.02 else "stable"
        confidence = min(0.98, max(0.6, 0.75 + abs(change) * 8))
        affected_ha = abs(change) * area_ha * 0.5 if change < 0 else 0

        sample_polygons = []
        if severity in ("critical", "significant"):
            sample_polygons = _generate_sample_polygons(zone_id, area_ha, affected_ha)

        summary = _build_summary(zone_name, change, affected_ha / max(1, area_ha) * 100, severity, before_year, after_year)

        result = SatelliteScanResult()
        result.zone_id = zone_id
        result.zone_name = zone_name
        result.before_year = before_year
        result.after_year = after_year
        result.before_ndvi = before_ndvi
        result.after_ndvi = after_ndvi
        result.ndvi_change = change
        result.change_pct = change * 100
        result.affected_area_ha = affected_ha
        result.severity = severity
        result.confidence = confidence
        result.change_type = change_type
        result.detected_at = datetime.now(timezone.utc).isoformat()
        result.data_source = "sentinel-2"
        result.change_polygons = sample_polygons
        result.summary = summary
        return result


def _generate_sample_polygons(zone_id, area_ha, affected_ha):
    from backend.services.database import query
    rows = query("SELECT ST_X(ST_Centroid(geom)) as lon, ST_Y(ST_Centroid(geom)) as lat FROM zones WHERE id = %s", (zone_id,))
    if not rows or not rows[0]["lon"]:
        return []
    cx, cy = rows[0]["lon"], rows[0]["lat"]
    num_polygons = max(1, min(5, int(affected_ha / 50)))
    polygons = []
    rng = random.Random(hashlib.md5(str(zone_id).encode()).hexdigest())
    for _ in range(num_polygons):
        plon = cx + rng.uniform(-0.06, 0.06)
        plat = cy + rng.uniform(-0.04, 0.04)
        size = rng.uniform(0.005, 0.02)
        coords = [[
            [plon - size, plat - size],
            [plon + size, plat - size],
            [plon + size, plat + size],
            [plon - size, plat + size],
            [plon - size, plat - size],
        ]]
        polygons.append({"type": "Polygon", "coordinates": coords})
    return polygons


def _build_summary(name, change, cover_loss, severity, before_year, after_year):
    span = after_year - before_year
    if severity == "critical":
        return f"CRITICAL: {name} shows severe vegetation decline of {abs(change):.3f} NDVI ({abs(change*100):.1f}%) over {span} years. Estimated {abs(cover_loss):.1f}% cover loss. Immediate field verification required."
    elif severity == "significant":
        return f"SIGNIFICANT: {name} vegetation declined by {abs(change):.3f} NDVI ({abs(change*100):.1f}%) over {span} years. Cover loss approximately {abs(cover_loss):.1f}%. This pattern suggests active deforestation."
    elif severity == "moderate":
        return f"MODERATE: {name} shows {abs(change*100):.1f}% NDVI decline over {span} years. Monitor for further degradation."
    elif severity == "minor":
        return f"MINOR: {name} vegetation change of {change*100:.1f}% over {span} years. Within normal variation."
    else:
        return f"STABLE: {name} vegetation health remained consistent over {span} years ({change*100:+.1f}% change)."


def get_provider() -> SatelliteProvider:
    sentinel = SentinelHubProvider()
    if sentinel.is_available():
        return sentinel
    return DemoProvider()
