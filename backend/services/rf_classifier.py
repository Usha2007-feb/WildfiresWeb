"""Random Forest land-cover classifier for the encroachment pipeline.

Training samples are extracted from ESA WorldCover 10 m (2021) via Earth Engine
and cached as a small NumPy file so the model is only re-trained when the
reference data changes.

Land-cover class mapping (WorldCover → project labels)
    10  Tree cover         → 0  Forest
    20  Shrubland          → 5  Other vegetation
    30  Grassland          → 5  Other vegetation
    40  Cropland           → 1  Agriculture
    50  Built-up           → 2  Settlement/construction
    60  Bare/sparse veg.   → 3  Bare soil
    70  Snow/ice           → -1 (excluded)
    80  Permanent water    → 4  Water
    90  Herbaceous wetland → 5  Other vegetation
    95  Mangroves          → 0  Forest
   100  Moss/lichen        → 5  Other vegetation
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = ROOT / "models"
SAMPLE_DIR = ROOT / "data" / "imagery"

# ── GPU detection (cuML / RAPIDS) ─────────────────────────────────────────────
try:
    from cuml.ensemble import RandomForestClassifier as _CuMLRF  # type: ignore
    _GPU_AVAILABLE = True
    logger.info("cuML detected — RF training/inference will use the GPU.")
except Exception:
    _CuMLRF = None  # type: ignore
    _GPU_AVAILABLE = False

# Serialise model training so two threads never double-train the same model
_TRAIN_LOCK: dict[str, threading.Lock] = {}
_TRAIN_LOCK_GLOBAL = threading.Lock()


def _region_lock(region: str) -> threading.Lock:
    with _TRAIN_LOCK_GLOBAL:
        if region not in _TRAIN_LOCK:
            _TRAIN_LOCK[region] = threading.Lock()
        return _TRAIN_LOCK[region]

# ── Class definitions ──────────────────────────────────────────────────────────
CLASS_NAMES = [
    "Forest",                 # 0
    "Agriculture",            # 1
    "Settlement/construction", # 2
    "Bare soil",              # 3
    "Water",                  # 4
    "Other vegetation",       # 5
]

# WorldCover value → class index (-1 → excluded)
_WC_REMAP: dict[int, int] = {
    10: 0, 20: 5, 30: 5, 40: 1, 50: 2,
    60: 3, 70: -1, 80: 4, 90: 5, 95: 0, 100: 5,
}

# Change class definitions (used by change_classify)
CHANGE_CLASSES = [
    "No significant change",        # 0
    "Forest degradation",           # 1
    "Deforestation/clearing",       # 2
    "New agriculture",              # 3
    "New settlement/construction",  # 4
    "Burn disturbance",             # 5
]

# Colour palettes (RGBA uint8 tuples) used by the tile renderer
LC_PALETTE: dict[int, tuple[int, int, int, int]] = {
    0: (34,  139, 34,  220),   # Forest
    1: (255, 215, 0,   220),   # Agriculture
    2: (210, 105, 30,  220),   # Settlement
    3: (194, 178, 128, 220),   # Bare soil
    4: (30,  144, 255, 220),   # Water
    5: (144, 238, 144, 220),   # Other veg
}

CHANGE_PALETTE: dict[int, tuple[int, int, int, int]] = {
    0:   (0,   0,   0,   0),   # No change
    1:   (255, 165, 0,   220), # Degradation
    2:   (220, 20,  60,  230), # Deforestation
    3:   (255, 255, 0,   220), # New agriculture
    4:   (128, 0,   128, 220), # New settlement
    5:   (139, 0,   0,   230), # Burn
    255: (0,   0,   0,   0),   # Nodata
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _feature_stack(bands: np.ndarray) -> np.ndarray:
    """Flatten a (C, H, W) band array into an (H*W, C) feature matrix."""
    c, h, w = bands.shape
    return bands.reshape(c, -1).T  # (N, C)


def _worldcover_to_class(wc: np.ndarray) -> np.ndarray:
    """Remap WorldCover pixel values to project class indices."""
    out = np.full(wc.shape, -1, dtype=np.int8)
    for wc_val, cls in _WC_REMAP.items():
        out[wc == wc_val] = cls
    return out


# ── Training ──────────────────────────────────────────────────────────────────

def _sample_path(region: str) -> Path:
    return SAMPLE_DIR / f"{region}_wc_samples.npz"


def _model_path(region: str) -> Path:
    return MODELS_DIR / f"lc_rf_{region}.joblib"


def _extract_worldcover_samples(
    region: str, bands: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """
    Attempt to load pre-extracted WorldCover samples for the region.
    Falls back to a coarse stratified spatial sample over the band array
    when no EE-derived sample file exists (allows the rest of the pipeline
    to work without an internet connection).
    """
    sample_file = _sample_path(region)
    if sample_file.exists():
        data = np.load(sample_file)
        logger.info("Loaded %d WorldCover samples for %s", len(data["y"]), region)
        return data["X"].astype(np.float32), data["y"].astype(np.int8)

    # ── Spatial stratification fallback ──────────────────────────────────────
    # Supports both:
    #   5-band derived index files  (NDVI, EVI, NBR, NDMI, BSI) — from download_indices_free.py
    #   6-band reflectance files    (blue, green, red, NIR, SWIR1, SWIR2)
    # This is intentionally approximate; replace with real WorldCover labels.
    logger.warning(
        "No WorldCover sample file found for %s. Using index-based fallback labels "
        "(for development only). Run scripts/extract_worldcover.py to generate real labels.",
        region,
    )
    n_bands = bands.shape[0]
    b = bands.astype(np.float32)
    if n_bands == 5:
        # Derived indices: band 0 = NDVI, band 4 = BSI
        ndvi = b[0].ravel()   # NDVI
        bsi  = b[4].ravel()   # BSI
    elif n_bands >= 6:
        # Raw reflectance: derive NDVI from NIR (3) and red (2)
        nir_r = b[3].ravel()
        red_r = b[2].ravel()
        denom = nir_r + red_r
        ndvi = np.where(np.abs(denom) > 1e-6, (nir_r - red_r) / denom, 0.0)
        bsi  = np.zeros_like(ndvi)
    else:
        raise ValueError(f"Need at least 5 bands for training, got {n_bands}.")

    labels = np.full(ndvi.shape, 5, dtype=np.int8)  # default: other veg
    labels[ndvi > 0.50] = 0                            # forest
    labels[(ndvi > 0.1) & (ndvi <= 0.50)] = 1          # agriculture / shrub
    labels[(ndvi <= 0.1) & (bsi > 0.05)] = 3           # bare soil
    labels[ndvi < -0.1] = 4                            # water

    X = _feature_stack(bands)
    valid = np.isfinite(X).all(axis=1)
    X, labels = X[valid], labels[valid]

    # Balance: keep at most 1000 samples per class (enough for a solid fallback RF;
    # more samples require more RAM during training)
    rng = np.random.default_rng(42)
    idx: list[np.ndarray] = []
    for cls in range(len(CLASS_NAMES)):
        where = np.where(labels == cls)[0]
        n = min(len(where), 1000)  # cap at 1000 to stay within available RAM
        if n:
            idx.append(rng.choice(where, n, replace=False))
    idx_arr = np.concatenate(idx)
    return X[idx_arr], labels[idx_arr]


def train_or_load(region: str, bands: np.ndarray) -> Any:
    """Return a fitted classifier for the region (GPU-accelerated if available).

    Uses cuML RandomForest when an NVIDIA GPU + RAPIDS is installed, otherwise
    falls back to scikit-learn.  The fitted model is cached to
    ``models/lc_rf_<region>.joblib``.

    A per-region lock ensures two concurrent requests never double-train.
    """
    import joblib

    model_file = _model_path(region)
    MODELS_DIR.mkdir(exist_ok=True)

    # Fast path: model already on disk
    if model_file.exists():
        try:
            logger.info("Loading cached RF model: %s", model_file)
            return joblib.load(model_file)
        except Exception as load_err:
            logger.warning(
                "Cached model %s is corrupt (%s) — deleting and retraining.",
                model_file.name, load_err,
            )
            model_file.unlink(missing_ok=True)

    # Slow path: train (serialised per region to avoid double-training)
    with _region_lock(region):
        # Re-check inside the lock — another thread may have trained while we waited
        if model_file.exists():
            return joblib.load(model_file)

        logger.info("Training RF classifier for %s (GPU=%s) …", region, _GPU_AVAILABLE)
        X, y = _extract_worldcover_samples(region, bands)
        keep = y >= 0
        X, y = X[keep], y[keep]

        if _GPU_AVAILABLE and _CuMLRF is not None:
            try:
                clf = _CuMLRF(
                    n_estimators=200,
                    max_depth=16,           # cuML works best with bounded depth
                    min_samples_leaf=5,
                    n_streams=4,            # cuML parallel streams
                    random_state=42,
                    accuracy_metric="oob",
                )
                clf.fit(X.astype(np.float32), y.astype(np.int32))
                logger.info("cuML RF trained for %s", region)
            except Exception as gpu_err:
                logger.warning("cuML training failed (%s) — falling back to sklearn.", gpu_err)
                clf = _sklearn_rf(X, y, region)
        else:
            clf = _sklearn_rf(X, y, region)

        joblib.dump(clf, model_file)
        logger.info("Saved RF model → %s", model_file)
        return clf


def _sklearn_rf(X: np.ndarray, y: np.ndarray, region: str) -> Any:
    """Train a scikit-learn RandomForestClassifier and log OOB accuracy."""
    from sklearn.ensemble import RandomForestClassifier

    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=None,
        min_samples_leaf=5,
        n_jobs=-1,              # all CPU cores
        random_state=42,
        class_weight="balanced",
        oob_score=True,
    )
    clf.fit(X, y)
    logger.info(
        "sklearn RF trained for %s — OOB accuracy = %.3f",
        region, clf.oob_score_,
    )
    return clf


# ── Inference ─────────────────────────────────────────────────────────────────

# Batch size for prediction: cap at 250 k pixels to bound peak RAM per call
_PREDICT_BATCH = 250_000


def predict(clf: Any, bands: np.ndarray) -> np.ndarray:
    """Classify every pixel in a (C, H, W) band array.

    Uses GPU inference if *clf* is a cuML model.  For large rasters the valid
    pixels are processed in batches of ``_PREDICT_BATCH`` so peak RAM stays
    bounded regardless of image size.

    Returns an (H, W) int8 array of class indices (-1 = nodata).
    """
    c, h, w = bands.shape
    X = _feature_stack(bands)                          # (N, C)
    valid_mask = np.isfinite(X).all(axis=1)             # (N,)
    valid_idx  = np.where(valid_mask)[0]

    result = np.full(h * w, -1, dtype=np.int8)
    if valid_idx.size == 0:
        return result.reshape(h, w)

    X_valid = X[valid_idx]

    # Check if this is a cuML model (has no sklearn-style __module__)
    is_cuml = _GPU_AVAILABLE and hasattr(clf, "n_streams")

    if is_cuml:
        try:
            import cupy as cp  # type: ignore
            X_gpu = cp.array(X_valid.astype(np.float32))
            preds = clf.predict(X_gpu)
            result[valid_idx] = cp.asnumpy(preds).astype(np.int8)
        except Exception as gpu_err:
            logger.warning("GPU predict failed (%s) — falling to CPU batched.", gpu_err)
            is_cuml = False  # fall through

    if not is_cuml:
        # CPU batched prediction to keep peak RAM bounded
        preds = np.empty(valid_idx.size, dtype=np.int8)
        for start in range(0, valid_idx.size, _PREDICT_BATCH):
            end = min(start + _PREDICT_BATCH, valid_idx.size)
            preds[start:end] = clf.predict(X_valid[start:end]).astype(np.int8)
        result[valid_idx] = preds

    return result.reshape(h, w)


# ── Change classification ─────────────────────────────────────────────────────

def change_classify(
    lc_before: np.ndarray,
    lc_after: np.ndarray,
    deltas: dict[str, np.ndarray],
) -> np.ndarray:
    """Assign a change class to each pixel.

    Parameters
    ----------
    lc_before, lc_after : (H, W) int8 arrays of land-cover class indices
    deltas : dict of delta index arrays (ndvi, nbr, ndmi, evi, bsi)

    Returns
    -------
    (H, W) uint8 array of change class indices (see CHANGE_CLASSES)
    """
    h, w = lc_before.shape
    result = np.zeros((h, w), dtype=np.uint8)  # default: no change

    d_ndvi = deltas.get("ndvi", np.zeros((h, w)))
    d_nbr  = deltas.get("nbr",  np.zeros((h, w)))
    d_ndmi = deltas.get("ndmi", np.zeros((h, w)))
    d_evi  = deltas.get("evi",  np.zeros((h, w)))
    d_bsi  = deltas.get("bsi",  np.zeros((h, w)))

    was_forest = lc_before == 0
    now_not_forest = lc_after != 0
    now_agri = lc_after == 1
    now_settle = lc_after == 2

    # Burn disturbance: high NBR loss, regardless of class
    burn = d_nbr >= 0.20
    result[burn] = 5

    # New settlement
    new_settle = ~was_forest & now_settle & (d_bsi >= 0.08)
    result[new_settle] = 4

    # Forest → agriculture
    deforest_agri = was_forest & now_agri & (d_ndvi >= 0.15)
    result[deforest_agri] = 3

    # Full deforestation / clearing
    deforest = was_forest & now_not_forest & (d_ndvi >= 0.20) & (~now_agri)
    result[deforest] = 2

    # Forest degradation (still forest class but significant NDVI loss)
    degradation = was_forest & (~now_not_forest) & (d_ndvi >= 0.10)
    result[degradation] = 1

    # Mask nodata
    nodata = (lc_before < 0) | (lc_after < 0)
    result[nodata] = 255  # sentinel for nodata

    return result


# ── WorldCover sample extraction via Earth Engine ─────────────────────────────

def extract_worldcover_samples_ee(region: str, boundary_path: Path) -> None:
    """Download WorldCover samples for a region via Earth Engine.

    Saves an NPZ file to ``data/imagery/<region>_wc_samples.npz`` containing
    ``X`` (feature matrix, float32) and ``y`` (class labels, int8).

    This function requires ``earthengine-api`` and authenticated credentials.
    It is called by ``scripts/extract_worldcover.py`` and is *not* called at
    analysis time (the model loads the pre-saved NPZ).
    """
    try:
        import ee
        import json
    except ImportError as exc:
        raise RuntimeError("earthengine-api is required for this step.") from exc

    with boundary_path.open() as f:
        geojson = json.load(f)

    roi = ee.FeatureCollection(geojson).geometry()

    wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map").clip(roi)

    # Sample 5000 random points
    samples = wc.sample(region=roi, scale=10, numPixels=5000, seed=42, geometries=False)
    data = samples.getInfo()

    # Map WC values to class indices
    rows: list[tuple[int, int]] = []
    for feat in data["features"]:
        wc_val = feat["properties"].get("Map")
        if wc_val is not None:
            cls = _WC_REMAP.get(int(wc_val), -1)
            rows.append((int(wc_val), cls))

    if not rows:
        logger.warning("No WorldCover samples retrieved for %s.", region)
        return

    # We don't have band values here — those come from the GeoTIFF.
    # This function stores only the (pixel_row, pixel_col, label) indices
    # that will be joined to the raster in a separate step.
    # For now, save the raw WC labels array for use by the fallback sampler.
    labels = np.array([r[1] for r in rows], dtype=np.int8)
    out = _sample_path(region)
    out.parent.mkdir(exist_ok=True)
    # Placeholder X (zeros) — will be filled by join_worldcover_samples.py
    np.savez_compressed(out, y=labels, X=np.zeros((len(labels), 6), dtype=np.float32))
    logger.info("Saved %d WorldCover labels for %s → %s", len(labels), region, out)
