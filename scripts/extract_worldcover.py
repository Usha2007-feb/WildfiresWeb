"""Extract ESA WorldCover (v200) training samples and join to local GeoTIFF bands.

For each region this script:
  1. Samples random pixel locations inside the boundary from WorldCover (EE).
  2. Reads band values at those locations from the local *_indices.tif file.
  3. Saves  data/imagery/{region}_wc_samples.npz  (X: float32, y: int8).

Once the .npz files exist, ``backend/services/rf_classifier.train_or_load()``
will automatically use them to train and cache the Random Forest model.

Usage
-----
    python scripts/extract_worldcover.py --project wildfire-india-ee
    python scripts/extract_worldcover.py --project wildfire-india-ee \\
        --regions laisong corbett --n-samples 8000 --workers 4
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
BOUNDARY_DIR = ROOT / "frontend" / "public" / "gis" / "boundaries"
IMAGERY_DIR = ROOT / "data" / "imagery"
ALL_REGIONS = ("laisong", "corbett", "jyotikuchi", "similipal")

# WorldCover value → project class index (-1 = exclude)
_WC_REMAP: dict[int, int] = {
    10: 0,   # Tree cover       → Forest
    20: 5,   # Shrubland        → Other veg
    30: 5,   # Grassland        → Other veg
    40: 1,   # Cropland         → Agriculture
    50: 2,   # Built-up         → Settlement
    60: 3,   # Bare/sparse      → Bare soil
    70: -1,  # Snow/ice         → exclude
    80: 4,   # Water            → Water
    90: 5,   # Wetland          → Other veg
    95: 0,   # Mangroves        → Forest
    100: 5,  # Moss/lichen      → Other veg
}

# Band order in the *_indices.tif files (from download_indices_free.py)
BAND_NAMES = ["NDVI", "EVI", "NBR", "NDMI", "BSI"]


def _find_tif(region: str, year: int) -> Path:
    matches = [
        p for p in (IMAGERY_DIR / region / str(year)).glob("*.tif")
        if not p.stem.startswith(".")
    ]
    if not matches:
        raise FileNotFoundError(f"No GeoTIFF for {region}/{year}")
    return sorted(matches)[0]


def _ee_sample(region: str, n_samples: int) -> list[dict]:
    """Return a list of {lon, lat, wc_class} dicts from EE WorldCover sampling."""
    import ee

    boundary_path = BOUNDARY_DIR / f"{region}_boundary.geojson"
    with boundary_path.open(encoding="utf-8") as fh:
        geojson = json.load(fh)
    roi = ee.FeatureCollection(geojson).geometry()

    wc = (
        ee.ImageCollection("ESA/WorldCover/v200")
        .first()
        .select("Map")
        .clip(roi)
    )
    samples = wc.sample(
        region=roi,
        scale=20,           # match Sentinel-2 / index raster resolution
        numPixels=n_samples,
        seed=42,
        geometries=True,    # keep lat/lon
    )
    info = samples.getInfo()
    results = []
    for feat in info.get("features", []):
        wc_val = feat["properties"].get("Map")
        if wc_val is None:
            continue
        cls = _WC_REMAP.get(int(wc_val), -1)
        if cls < 0:
            continue
        coords = feat["geometry"]["coordinates"]  # [lon, lat]
        results.append({"lon": coords[0], "lat": coords[1], "cls": cls})
    return results


def _read_bands_at_points(tif_path: Path, points: list[dict]) -> "np.ndarray":
    """Read band values from the GeoTIFF at the given lon/lat sample points.

    Returns a (N, C) float32 array; rows with all-NaN are preserved — the
    caller filters them.
    """
    import numpy as np
    import rasterio
    from rasterio.transform import rowcol

    with rasterio.open(tif_path) as src:
        n_bands = src.count
        n_pts = len(points)
        X = np.full((n_pts, n_bands), np.nan, dtype=np.float32)
        for i, pt in enumerate(points):
            try:
                row, col = rowcol(src.transform, pt["lon"], pt["lat"])
                if 0 <= row < src.height and 0 <= col < src.width:
                    window = rasterio.windows.Window(col, row, 1, 1)
                    vals = src.read(window=window)          # (C, 1, 1)
                    X[i] = vals[:, 0, 0].astype(np.float32)
            except Exception:
                pass
    return X


def _process_region(region: str, n_samples: int, year: int) -> None:
    import numpy as np

    out_path = IMAGERY_DIR / f"{region}_wc_samples.npz"
    if out_path.exists():
        log.info("[%s] Sample file already exists (%s) — skipping.", region, out_path.name)
        return

    try:
        tif_path = _find_tif(region, year)
    except FileNotFoundError as exc:
        log.error("[%s] %s", region, exc)
        return

    log.info("[%s] Sampling %d points from WorldCover via EE…", region, n_samples)
    try:
        points = _ee_sample(region, n_samples)
    except Exception as exc:
        log.error("[%s] EE sampling failed: %s", region, exc)
        return

    if not points:
        log.warning("[%s] No valid points returned from EE.", region)
        return

    log.info("[%s] Reading band values at %d sample locations from %s…", region, len(points), tif_path.name)
    X = _read_bands_at_points(tif_path, points)
    y = np.array([pt["cls"] for pt in points], dtype=np.int8)

    # Drop rows where any band is NaN or infinite
    valid = np.isfinite(X).all(axis=1)
    X, y = X[valid], y[valid]

    if len(X) == 0:
        log.error("[%s] No valid band values extracted.", region)
        return

    # Balance: keep at most 3000 samples per class
    rng = np.random.default_rng(42)
    keep_idx: list[np.ndarray] = []
    for cls in range(6):
        where = np.where(y == cls)[0]
        n = min(len(where), 3000)
        if n:
            keep_idx.append(rng.choice(where, n, replace=False))
    if not keep_idx:
        log.error("[%s] No usable class samples.", region)
        return
    idx = np.concatenate(keep_idx)
    X, y = X[idx], y[idx]

    np.savez_compressed(out_path, X=X, y=y)
    log.info(
        "[%s] Saved %d samples (%s) → %s",
        region, len(y), {i: int((y == i).sum()) for i in range(6)}, out_path,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="Google Cloud / EE project ID")
    parser.add_argument(
        "--regions", nargs="+", default=list(ALL_REGIONS), choices=list(ALL_REGIONS)
    )
    parser.add_argument("--n-samples", type=int, default=3000, help="EE sample points per region (keep <= 4000 for getInfo limits)")
    parser.add_argument(
        "--year", type=int, default=2023,
        help="Which year's GeoTIFF to read band values from (default: 2023)"
    )
    parser.add_argument(
        "--workers", type=int, default=2,
        help="Parallel regions to process (each calls EE independently)"
    )
    args = parser.parse_args()

    try:
        import ee
        ee.Initialize(project=args.project)
        log.info("Earth Engine initialised (project=%s)", args.project)
    except ImportError as exc:
        raise SystemExit("Install earthengine-api: pip install -r scripts/requirements-earthengine.txt") from exc
    except Exception as exc:
        raise SystemExit(f"EE authentication failed: {exc}") from exc

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(_process_region, region, args.n_samples, args.year): region
            for region in args.regions
        }
        for future in concurrent.futures.as_completed(futures):
            region = futures[future]
            try:
                future.result()
            except Exception as exc:
                log.error("[%s] Unhandled error: %s", region, exc)

    log.info("Done. Re-run the backend to train and cache RF models automatically.")


if __name__ == "__main__":
    main()
