"""Local, reproducible multi-index forest-change analysis with RF classification.

The service accepts the annual 5-band index GeoTIFFs exported by
``scripts/download_indices_free.py`` (bands: NDVI, EVI, NBR, NDMI, BSI) and:

 1. Reads both the "before" and "after" composites in parallel.
 2. Computes all five Δ-index change maps.
 3. Applies a conservative multi-signal forest-loss baseline to identify
    candidate change polygons.
 4. Trains (or loads a cached) Random Forest classifier from WorldCover
    reference labels and classifies both composites.
 5. Applies the change-class rule set to produce a per-pixel change map.
 6. Returns area statistics per land-cover class and per change class.

Accuracy assessment is intentionally withheld until labelled validation
samples are provided (see accuracy_note in the response).
"""
from __future__ import annotations

import concurrent.futures
import threading
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from scipy import ndimage

from backend.services.rf_classifier import (
    CLASS_NAMES,
    CHANGE_CLASSES,
    CHANGE_PALETTE as RF_CHANGE_PALETTE,
    LC_PALETTE as RF_LC_PALETTE,
    change_classify,
    predict,
    train_or_load,
)

ROOT = Path(__file__).resolve().parents[2]
IMAGERY_DIR = ROOT / "data" / "imagery"

# Thread-local rasterio import avoidance for module-level
_lock = threading.Lock()

# ── Change / LC colour palettes for the response (hex) ───────────────────────
CHANGE_CLASS_COLORS = {
    "No significant change":      "#94A3B8",
    "Forest degradation":          "#F97316",
    "Deforestation/clearing":      "#DC2626",
    "New agriculture":             "#EAB308",
    "New settlement/construction": "#7C3AED",
    "Burn disturbance":            "#7F1D1D",
}
LC_CLASS_COLORS = {
    "Forest":                  "#22863A",
    "Agriculture":             "#F59E0B",
    "Settlement/construction": "#92400E",
    "Bare soil":               "#D97706",
    "Water":                   "#3B82F6",
    "Other vegetation":        "#86EFAC",
}


class ImageryUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class RasterPair:
    before: Path
    after: Path


# ── Utility ───────────────────────────────────────────────────────────────────

def available_years(region: str) -> list[int]:
    years: set[int] = set()
    for path in IMAGERY_DIR.rglob("*.tif"):
        if region.lower() in path.as_posix().lower():
            years.update(
                int(part)
                for part in path.stem.lower().replace("-", "_").split("_")
                if part.isdigit() and len(part) == 4
            )
    return sorted(years)


def _find_raster(region: str, year: int) -> Path:
    matches = [
        p for p in IMAGERY_DIR.rglob("*.tif")
        if region.lower() in p.as_posix().lower()
        and str(year) in p.stem
        and not p.stem.startswith(".")
    ]
    if not matches:
        raise ImageryUnavailable(f"No local GeoTIFF found for {region} in {year}.")
    return sorted(
        matches,
        key=lambda p: ("indices" not in p.stem.lower(), len(p.as_posix())),
    )[0]


def _normalised_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    denom = a + b
    return np.divide(
        a - b, denom,
        out=np.full(a.shape, np.nan, dtype=np.float32),
        where=np.abs(denom) > 1e-6,
    )


# ── Raster reading ────────────────────────────────────────────────────────────

def _is_derived(path: Path, count: int) -> bool:
    """True if the TIF contains pre-computed index bands (NDVI, EVI, …)."""
    return "indices" in path.stem.lower() or count == 5


def _read_indices_from_bands(bands: np.ndarray) -> dict[str, np.ndarray]:
    """Calculate indices from raw reflectance bands (B2/B4/B8/B11/B12 order)."""
    if bands.shape[0] < 6:
        raise ImageryUnavailable(
            "GeoTIFF has fewer than 6 bands. "
            "Re-export with the current downloader (blue,green,red,NIR,SWIR1,SWIR2)."
        )
    blue, _green, red, nir, swir1, swir2 = bands[:6].astype(np.float32)
    return {
        "ndvi": _normalised_difference(nir, red),
        "nbr":  _normalised_difference(nir, swir2),
        "ndmi": _normalised_difference(nir, swir1),
        "evi": np.divide(
            2.5 * (nir - red),
            nir + 6 * red - 7.5 * blue + 1,
            out=np.full(nir.shape, np.nan, dtype=np.float32),
            where=np.abs(nir + 6 * red - 7.5 * blue + 1) > 1e-6,
        ),
        "bsi": _normalised_difference((swir1 + red), (nir + blue)),
    }


def _read_indices_from_derived(bands: np.ndarray) -> dict[str, np.ndarray]:
    """Read pre-computed bands (NDVI, EVI, NBR, NDMI, BSI)."""
    if bands.shape[0] < 5:
        raise ImageryUnavailable(
            "Derived-index GeoTIFF must contain NDVI, EVI, NBR, NDMI, BSI bands."
        )
    return {
        name: bands[i].astype(np.float32)
        for i, name in enumerate(("ndvi", "evi", "nbr", "ndmi", "bsi"))
    }


def _read_one_raster(
    path: Path,
) -> tuple[np.ndarray, dict[str, np.ndarray], Any, Any, float]:
    """Return (raw_bands, index_dict, transform, crs, pixel_area_ha) for *path*."""
    try:
        import rasterio
    except ImportError as exc:
        raise ImageryUnavailable(
            "rasterio is not installed. Run: pip install rasterio"
        ) from exc

    with rasterio.open(path) as src:
        raw = src.read(out_dtype="float32")
        transform = src.transform
        crs = src.crs
        derived = _is_derived(path, src.count)
        if crs and crs.is_geographic:
            lat = (src.bounds.top + src.bounds.bottom) / 2
            pix_ha = (
                abs(transform.a) * 111_320 * np.cos(np.deg2rad(lat))
                * abs(transform.e) * 110_574
                / 10_000
            )
        else:
            pix_ha = abs(transform.a * transform.e) / 10_000

    indices = (
        _read_indices_from_derived(raw)
        if derived
        else _read_indices_from_bands(raw)
    )
    return raw, indices, transform, crs, pix_ha


def _read_pair_parallel(
    pair: RasterPair,
) -> tuple[
    np.ndarray,
    dict[str, np.ndarray],
    np.ndarray,
    dict[str, np.ndarray],
    Any,
    Any,
    float,
]:
    """Read before and after rasters in parallel worker threads.

    Returns
    -------
    before_raw, before_idx, after_raw, after_idx, after_transform, after_crs, pixel_area_ha
    """
    try:
        import rasterio
        from rasterio.warp import Resampling, reproject as rio_reproject
    except ImportError as exc:
        raise ImageryUnavailable("rasterio not installed.") from exc

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        f_before = pool.submit(_read_one_raster, pair.before)
        f_after  = pool.submit(_read_one_raster, pair.after)
        before_raw, before_idx, b_transform, b_crs, _ = f_before.result()
        after_raw,  after_idx,  a_transform, a_crs, pix_ha = f_after.result()

    # Reproject "before" bands/indices onto the "after" grid if grids differ
    if before_raw.shape != after_raw.shape or b_transform != a_transform:
        _c, h, w = after_raw.shape
        new_before_raw = np.full(
            (before_raw.shape[0], h, w), np.nan, dtype=np.float32
        )
        for band_i in range(before_raw.shape[0]):
            rio_reproject(
                source=before_raw[band_i],
                destination=new_before_raw[band_i],
                src_transform=b_transform,
                src_crs=b_crs,
                dst_transform=a_transform,
                dst_crs=a_crs,
                resampling=Resampling.bilinear,
                dst_nodata=np.nan,
            )
        before_raw = new_before_raw
        # Recompute before_idx on the reprojected grid
        before_idx = (
            _read_indices_from_derived(before_raw)
            if _is_derived(pair.before, before_raw.shape[0])
            else _read_indices_from_bands(before_raw)
        )

    return before_raw, before_idx, after_raw, after_idx, a_transform, a_crs, pix_ha


# ── Polygon extraction ────────────────────────────────────────────────────────

def _vectorise(
    mask: np.ndarray,
    transform: Any,
    pixel_area_ha: float,
    label: str,
    change_type: str,
    min_ha: float = 0.25,
) -> list[dict[str, Any]]:
    """Convert a boolean mask to GeoJSON features, filtering small patches."""
    try:
        from rasterio.features import shapes
        from shapely.geometry import mapping, shape
    except ImportError as exc:
        raise ImageryUnavailable("rasterio/shapely not installed.") from exc

    # Morphological opening removes isolated noise
    cleaned = ndimage.binary_opening(mask, structure=np.ones((3, 3)))
    
    # Use uint8 for rasterio compatibility (zero-copy)
    uint8_mask = cleaned.astype("uint8")

    features: list[dict[str, Any]] = []
    for geom, val in shapes(uint8_mask, mask=uint8_mask, transform=transform):
        if not val:
            continue
        polygon = shape(geom).simplify(0.00005, preserve_topology=True)
        
        # Estimate area from bounding pixel count
        bounds = polygon.bounds  # (minx, miny, maxx, maxy) in CRS units
        dx = abs(transform.a)
        dy = abs(transform.e)
        if dx > 0 and dy > 0:
            n_px = round((bounds[2] - bounds[0]) / dx) * round((bounds[3] - bounds[1]) / dy)
            area_ha = float(n_px * pixel_area_ha)
        else:
            area_ha = 0.0
            
        if area_ha < min_ha:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": mapping(polygon),
                "properties": {
                    "id": f"change-{len(features) + 1}",
                    "label": label,
                    "type": change_type,
                    "area_ha": round(area_ha, 3),
                },
            }
        )
    return features


# ── Area statistics ───────────────────────────────────────────────────────────

def _class_areas(
    class_map: np.ndarray,
    class_names: list[str],
    pixel_area_ha: float,
    nodata_val: int = -1,
) -> dict[str, float]:
    return {
        name: round(float((class_map == i).sum() * pixel_area_ha), 3)
        for i, name in enumerate(class_names)
    }


def _change_areas(
    change_map: np.ndarray,
    pixel_area_ha: float,
) -> dict[str, float]:
    result: dict[str, float] = {}
    for i, name in enumerate(CHANGE_CLASSES):
        result[name] = round(float((change_map == i).sum() * pixel_area_ha), 3)
    return result


# ── Public API ────────────────────────────────────────────────────────────────

def analyse(region: str, before_year: int, after_year: int) -> dict[str, Any]:
    """Run the full change-detection pipeline for a region/year pair.

    Returns a JSON-serialisable dict with:
      - summary (candidate area, mean deltas)
      - land_cover (before / after per-class areas)
      - change_classes (per-class area)
      - features (GeoJSON FeatureCollection by change type)
      - method and accuracy fields
    """
    if before_year >= after_year:
        raise ValueError("before_year must be earlier than after_year")

    pair = RasterPair(
        _find_raster(region, before_year),
        _find_raster(region, after_year),
    )

    # ── 1. Parallel raster read ───────────────────────────────────────────────
    (
        before_raw, before_idx,
        after_raw,  after_idx,
        transform, crs, pix_ha,
    ) = _read_pair_parallel(pair)

    # ── 2. Delta index maps ───────────────────────────────────────────────────
    deltas = {name: before_idx[name] - after_idx[name] for name in before_idx}

    # ── 3. Valid pixel mask ───────────────────────────────────────────────────
    valid = np.logical_and.reduce(
        [np.isfinite(v) for v in (*before_idx.values(), *after_idx.values())]
    )

    # ── 4. Conservative multi-signal baseline ────────────────────────────────
    before_forest = (before_idx["ndvi"] >= 0.45) & (before_idx["evi"] >= 0.20)
    after_nonforest = (after_idx["ndvi"] < 0.45) | (after_idx["evi"] < 0.20)
    signals = (
        (deltas["ndvi"] >= 0.15).astype("uint8")
        + (deltas["nbr"]  >= 0.10).astype("uint8")
        + (deltas["ndmi"] >= 0.10).astype("uint8")
        + (deltas["evi"]  >= 0.10).astype("uint8")
        + (deltas["bsi"]  >= 0.08).astype("uint8")
    )
    candidate_mask = valid & before_forest & after_nonforest & (signals >= 3)

    # ── 5. RF land-cover classification (sequential — bounds peak RAM) ────────
    lc_before: np.ndarray | None = None
    lc_after:  np.ndarray | None = None
    change_map: np.ndarray | None = None
    lc_before_areas: dict[str, float] = {}
    lc_after_areas:  dict[str, float] = {}
    change_areas:    dict[str, float] = {}

    try:
        # Train/load the model once (uses the before raster for training labels),
        # then classify both periods.  Running sequentially halves peak RAM vs.
        # launching two concurrent classification jobs.
        clf = train_or_load(region, before_raw)
        lc_before = predict(clf, before_raw)
        lc_after  = predict(clf, after_raw)
        del clf  # release model RAM before vectorisation

        change_map = change_classify(lc_before, lc_after, deltas)
        lc_before_areas = _class_areas(lc_before, CLASS_NAMES, pix_ha)
        lc_after_areas  = _class_areas(lc_after,  CLASS_NAMES, pix_ha)
        change_areas    = _change_areas(change_map, pix_ha)

    except Exception as rf_error:
        # RF failure must not break the baseline analysis
        import logging
        logging.getLogger(__name__).warning("RF classification skipped: %s", rf_error)

    # ── 6. Vectorise change polygons ─────────────────────────────────────────
    # Use change_map if available; fall back to the conservative baseline mask
    all_features: list[dict[str, Any]] = []

    if change_map is not None:
        change_type_masks: dict[int, tuple[str, str]] = {
            1: ("Forest degradation",          "forest_degradation"),
            2: ("Deforestation/clearing",       "deforestation"),
            3: ("New agriculture",              "new_agriculture"),
            4: ("New settlement/construction",  "new_settlement"),
            5: ("Burn disturbance",             "burn_disturbance"),
        }
        for cls_idx, (label, ctype) in change_type_masks.items():
            mask = (change_map == cls_idx)
            all_features.extend(
                _vectorise(mask, transform, pix_ha, label, ctype)
            )
    else:
        all_features = _vectorise(
            candidate_mask, transform, pix_ha,
            "Verified forest-loss candidate", "forest_loss_candidate",
        )

    total_ha = sum(f["properties"]["area_ha"] for f in all_features)
    mean_deltas = {
        name: round(float(np.nanmean(v[valid])), 4)
        for name, v in deltas.items()
    }

    return {
        "status": "complete",
        "region": region,
        "before_year": before_year,
        "after_year": after_year,
        "source": {
            "before": str(pair.before.relative_to(ROOT)),
            "after":  str(pair.after.relative_to(ROOT)),
        },
        "method": {
            "name": "multi-index + Random Forest change detection",
            "indices": ["NDVI", "EVI", "NBR", "NDMI", "BSI"],
            "classification": (
                "Random Forest (WorldCover training); "
                "change detection requires ≥3 of 5 change signals"
            ),
            "accuracy": None,
            "accuracy_note": (
                "Accuracy assessment pending — no field-validated samples "
                "have been collected yet. Run scripts/extract_worldcover.py "
                "then supply manual validation polygons to enable accuracy reporting."
            ),
        },
        "summary": {
            "candidate_area_ha": round(total_ha, 3),
            "candidate_zones":   len(all_features),
            "mean_index_deltas": mean_deltas,
        },
        "land_cover": {
            "before": lc_before_areas,
            "after":  lc_after_areas,
            "class_colors": LC_CLASS_COLORS,
        },
        "change_classes": {
            "areas":         change_areas,
            "class_colors":  CHANGE_CLASS_COLORS,
        },
        "features": {
            "type": "FeatureCollection",
            "features": all_features,
        },
    }


# ── Index delta in-memory arrays (for tile overlay) ──────────────────────────

_analysis_cache: dict[str, dict[str, Any]] = {}
_cache_lock = threading.Lock()


def get_cached_analysis(region: str, before_year: int, after_year: int) -> dict[str, Any]:
    """Return cached analysis or run it synchronously."""
    key = f"{region}_{before_year}_{after_year}"
    with _cache_lock:
        if key in _analysis_cache:
            return _analysis_cache[key]
    result = analyse(region, before_year, after_year)
    with _cache_lock:
        _analysis_cache[key] = result
    return result


# ── RGB imagery tile (for true-colour Sentinel-2 view) ───────────────────────

def imagery_tile(region: str, year: int, z: int, x: int, y: int) -> bytes:
    """Render a small RGB PNG from the index GeoTIFF's first three bands."""
    try:
        import mercantile
        import rasterio
        from PIL import Image
        from rasterio.warp import transform_bounds
        from rasterio.windows import from_bounds
    except ImportError as exc:
        raise ImageryUnavailable(
            "Raster tile dependencies are not installed."
        ) from exc

    path = _find_raster(region, year)
    bounds = mercantile.bounds(x, y, z)
    with rasterio.open(path) as src:
        if src.count < 3:
            raise ImageryUnavailable(
                "The GeoTIFF does not contain enough bands for RGB display."
            )
        source_bounds = transform_bounds(
            "EPSG:4326", src.crs,
            bounds.west, bounds.south, bounds.east, bounds.north,
            densify_pts=21,
        )
        window = from_bounds(
            *source_bounds, transform=src.transform
        ).intersection(
            rasterio.windows.Window(0, 0, src.width, src.height)
        )
        if window.width <= 0 or window.height <= 0:
            return b""
        # For indices TIFFs: bands are NDVI, EVI, NBR → display as false colour
        data = src.read(
            [1, 2, 3],
            window=window,
            out_shape=(3, 256, 256),
            out_dtype="float32",
            boundless=True,
            fill_value=0,
        )
    rgb = np.zeros((256, 256, 3), dtype=np.uint8)
    for i, band in enumerate(data):
        valid = band[np.isfinite(band) & (band > -1) & (band < 1)]
        if valid.size:
            low, high = np.percentile(valid, (2, 98))
            rgb[:, :, i] = np.clip(
                (band - low) * 255 / max(high - low, 1e-6), 0, 255
            ).astype(np.uint8)
    buf = BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue()
