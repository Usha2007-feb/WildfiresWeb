"""Queue analysis-ready satellite composites for encroachment detection.

Each GeoTIFF contains reflectance bands required for NDVI, EVI, NBR, NDMI
and BSI: blue, green, red, NIR, SWIR1 and SWIR2.  Earth Engine does the
cloud/shadow masking and scaling before export; the backend then performs
the pairwise change analysis locally.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import ee
except ImportError as exc:
    raise SystemExit("Install Earth Engine first: pip install -r scripts/requirements-earthengine.txt") from exc

ROOT = Path(__file__).resolve().parents[1]
BOUNDARY_DIR = ROOT / "frontend" / "public" / "gis" / "boundaries"
MANIFEST_PATH = ROOT / "data" / "imagery" / "manifest.json"
BOUNDARIES = {name: f"{name}_boundary.geojson" for name in ("laisong", "corbett", "jyotikuchi", "similipal")}


def load_boundary(name: str) -> ee.Geometry:
    with (BOUNDARY_DIR / BOUNDARIES[name]).open(encoding="utf-8") as source:
        return ee.FeatureCollection(json.load(source)).geometry()


def _mask_sentinel2(image: ee.Image) -> ee.Image:
    """Mask cloud/shadow/snow classes while retaining surface reflectance."""
    scl = image.select("SCL")
    invalid = (scl.eq(3).Or(scl.eq(8)).Or(scl.eq(9)).Or(scl.eq(10)).Or(scl.eq(11)))
    qa60 = image.select("QA60")
    qa_clear = qa60.bitwiseAnd(1 << 10).eq(0).And(qa60.bitwiseAnd(1 << 11).eq(0))
    return image.updateMask(invalid.Not()).updateMask(qa_clear).multiply(0.0001)


def _mask_landsat(image: ee.Image) -> ee.Image:
    qa = image.select("QA_PIXEL")
    clear = qa.bitwiseAnd(1 << 1).eq(0).And(qa.bitwiseAnd(1 << 3).eq(0)).And(qa.bitwiseAnd(1 << 4).eq(0))
    return image.updateMask(clear).multiply(0.0000275).add(-0.2)


def make_image(sensor: str, region: ee.Geometry, year: int) -> tuple[ee.Image, int, list[str]]:
    start, end = f"{year}-01-01", f"{year + 1}-01-01"
    if sensor == "sentinel2":
        collection = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                      .filterBounds(region).filterDate(start, end)
                      .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 50))
                      .map(_mask_sentinel2))
        bands = ["B2", "B3", "B4", "B8", "B11", "B12"]
        return collection.median().select(bands).clip(region), 20, ["blue", "green", "red", "nir", "swir1", "swir2"]

    dataset = "LANDSAT/LE07/C02/T1_L2" if year < 2013 else "LANDSAT/LC08/C02/T1_L2"
    collection = (ee.ImageCollection(dataset).filterBounds(region).filterDate(start, end)
                  .filter(ee.Filter.lt("CLOUD_COVER", 60)).map(_mask_landsat))
    bands = ["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7"] if year < 2013 else ["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"]
    return collection.median().select(bands).clip(region), 30, ["blue", "green", "red", "nir", "swir1", "swir2"]


def existing_tasks() -> dict[str, ee.batch.Task]:
    result: dict[str, ee.batch.Task] = {}
    for task in ee.batch.Task.list():
        description = task.status().get("description")
        if description:
            result[description] = task
    return result


def read_manifest() -> dict[str, Any]:
    if not MANIFEST_PATH.exists():
        return {"exports": []}
    with MANIFEST_PATH.open(encoding="utf-8") as source:
        return json.load(source)


def write_manifest(manifest: dict[str, Any]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST_PATH.open("w", encoding="utf-8") as target:
        json.dump(manifest, target, indent=2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--drive-folder", default="wildfire_imagery", help="Google Drive folder for exported GeoTIFFs")
    parser.add_argument("--years", default="2011,2023")
    parser.add_argument("--regions", default=",".join(BOUNDARIES))
    parser.add_argument("--sensor", choices=("auto", "sentinel2", "landsat"), default="auto")
    parser.add_argument("--wait", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ee.Initialize(project=args.project)
    years = [int(value) for value in args.years.split(",") if value.strip()]
    regions = [value.strip().lower() for value in args.regions.split(",") if value.strip()]
    unknown = sorted(set(regions) - set(BOUNDARIES))
    if unknown:
        raise SystemExit(f"Unknown regions: {', '.join(unknown)}")

    existing = existing_tasks()
    manifest = read_manifest()
    pending: list[tuple[str, ee.batch.Task]] = []
    for name in regions:
        region = load_boundary(name)
        for year in years:
            sensor = "landsat" if args.sensor == "landsat" or (args.sensor == "auto" and year < 2015) else "sentinel2"
            description = f"wildfire_{name}_{sensor}_{year}"
            if description in existing:
                print(f"skip {description}: task already exists")
                if args.wait:
                    state = existing[description].status().get("state", "UNKNOWN")
                    if state in {"READY", "RUNNING"}:
                        pending.append((description, existing[description]))
                continue
            image, scale, bands = make_image(sensor, region, year)
            task = ee.batch.Export.image.toDrive(
                image=image,
                description=description,
                folder=args.drive_folder,
                fileNamePrefix=f"{name}_{year}_{sensor}",
                # Pass the server-side geometry directly. Converting complex
                # multipart boundaries to raw coordinates can produce an
                # invalid export region for Earth Engine.
                region=region,
                scale=scale,
                maxPixels=1e13,
                fileFormat="GeoTIFF",
                formatOptions={"cloudOptimized": True},
            )
            task.start()
            pending.append((description, task))
            manifest["exports"].append({"description": description, "region": name, "year": year, "sensor": sensor, "bands": bands, "scale_m": scale, "drive_folder": args.drive_folder, "submitted_at": datetime.now(timezone.utc).isoformat(), "task_id": task.id})
            print(f"submitted {description}: {task.id}")

    write_manifest(manifest)
    if not args.wait:
        return
    while pending:
        remaining = []
        for description, task in pending:
            state = task.status().get("state", "UNKNOWN")
            print(f"{description}: {state}")
            if state in {"READY", "RUNNING"}:
                remaining.append((description, task))
        pending = remaining
        if pending:
            time.sleep(30)


if __name__ == "__main__":
    main()
