"""Fast COG-aware raster tile renderer for index and classification maps.

Supports layers
---------------
ndvi / evi / nbr / ndmi / bsi     — single-band index from the 5-band index GeoTIFF
lc_before / lc_after              — land-cover classification map (categorical)
change                             — change classification map (categorical)

Each index layer is colourised with a perceptually uniform diverging palette.
Classification layers use a fixed categorical palette.

The renderer uses rasterio windowed reads so only the required 256×256 block
is loaded from disk.  COG overviews ensure that lower zoom levels read the
appropriate overview level instead of downsampling the full resolution data.
"""
from __future__ import annotations

import threading
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
IMAGERY_DIR = ROOT / "data" / "imagery"

# ── Index band mapping inside the *_indices.tif files ────────────────────────
INDEX_BAND: dict[str, int] = {
    "ndvi": 1,
    "evi": 2,
    "nbr": 3,
    "ndmi": 4,
    "bsi": 5,
}

# Colour ranges for each index:  (vmin, vmax) used for the diverging colourmap
INDEX_RANGE: dict[str, tuple[float, float]] = {
    "ndvi": (-0.5, 0.5),
    "evi": (-0.5, 0.5),
    "nbr": (-0.5, 0.5),
    "ndmi": (-0.5, 0.5),
    "bsi": (-0.4, 0.4),
}

# Land-cover palette: index → RGBA (uint8)
LC_PALETTE: dict[int, tuple[int, int, int, int]] = {
    0: (34,  139, 34,  220),   # Forest           — dark green
    1: (255, 215, 0,  220),    # Agriculture       — gold
    2: (210, 105, 30, 220),    # Settlement        — brown
    3: (194, 178, 128, 220),   # Bare soil         — sand
    4: (30,  144, 255, 220),   # Water             — dodger blue
    5: (144, 238, 144, 220),   # Other vegetation  — light green
}
LC_NODATA_RGBA = (0, 0, 0, 0)

# Change-class palette
CHANGE_PALETTE: dict[int, tuple[int, int, int, int]] = {
    0: (0,   0,   0,   0),     # No change          — transparent
    1: (255, 165, 0,  220),    # Forest degradation — orange
    2: (220, 20,  60, 230),    # Deforestation      — crimson
    3: (255, 255, 0,  220),    # New agriculture    — yellow
    4: (128, 0,   128, 220),   # New settlement     — purple
    5: (139, 0,   0,  230),    # Burn disturbance   — dark red
    255: (0,  0,   0,   0),    # Nodata             — transparent
}

# ── Colourmap helpers ─────────────────────────────────────────────────────────

def _build_rdylgn_lut(n: int = 256) -> np.ndarray:
    """Build an (n, 4) uint8 LUT for a Red→Yellow→Green diverging palette."""
    lut = np.zeros((n, 4), dtype=np.uint8)
    for i in range(n):
        t = i / (n - 1)
        if t < 0.5:
            r = 1.0
            g = t * 2
            b = 0.0
        else:
            r = 1.0 - (t - 0.5) * 2
            g = 1.0
            b = 0.0
        lut[i] = (int(r * 255), int(g * 255), int(b * 255), 220)
    return lut

_RDYLGN_LUT = _build_rdylgn_lut()

def _build_rdblu_lut(n: int = 256) -> np.ndarray:
    """Build an (n, 4) uint8 LUT for a Red→White→Blue diverging palette (BSI)."""
    lut = np.zeros((n, 4), dtype=np.uint8)
    for i in range(n):
        t = i / (n - 1)
        if t < 0.5:
            r = 1.0
            g = t * 2
            b = t * 2
        else:
            r = 1.0 - (t - 0.5) * 2
            g = 1.0 - (t - 0.5) * 2
            b = 1.0
        lut[i] = (int(r * 255), int(g * 255), int(b * 255), 200)
    return lut

_RDBLU_LUT = _build_rdblu_lut()


def _index_to_rgba(data: np.ndarray, vmin: float, vmax: float, layer: str) -> np.ndarray:
    """Map a (H, W) float32 index array to (H, W, 4) RGBA uint8."""
    lut = _RDBLU_LUT if layer == "bsi" else _RDYLGN_LUT
    # For vegetation indices: high value = healthy (green); low = degraded (red)
    # For BSI: high = bare (red); low = vegetated (blue)
    h, w = data.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    valid = np.isfinite(data)
    normed = np.clip((data - vmin) / (vmax - vmin), 0, 1)
    idx = (normed * 255).astype(np.uint8)
    rgba[valid] = lut[idx[valid]]
    return rgba


def _categorical_to_rgba(
    data: np.ndarray,
    palette: dict[int, tuple[int, int, int, int]],
) -> np.ndarray:
    h, w = data.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for val, colour in palette.items():
        mask = data == val
        if mask.any():
            rgba[mask] = colour
    return rgba


# ── GeoTIFF open — cache open file handles per path ─────────────────────────
_handle_lock = threading.Lock()
_handles: dict[Path, Any] = {}


def _open_raster(path: Path) -> Any:
    import rasterio
    with _handle_lock:
        if path not in _handles:
            _handles[path] = rasterio.open(path)
        return _handles[path]


def close_all_handles() -> None:
    with _handle_lock:
        for src in _handles.values():
            try:
                src.close()
            except Exception:
                pass
        _handles.clear()


# ── Core tile functions ───────────────────────────────────────────────────────

def _find_raster(region: str, year: int) -> Path:
    matches = [
        p for p in IMAGERY_DIR.rglob("*.tif")
        if region.lower() in p.as_posix().lower() and str(year) in p.stem
        and not p.stem.startswith(".")
    ]
    if not matches:
        raise FileNotFoundError(f"No GeoTIFF for {region}/{year}")
    return sorted(matches, key=lambda p: ("indices" not in p.stem, len(p.as_posix())))[0]


def render_index_tile(
    region: str,
    year: int,
    layer: str,
    z: int,
    x: int,
    y: int,
) -> bytes:
    """Render a 256×256 RGBA PNG tile for a single index layer.

    Parameters
    ----------
    layer : one of ndvi / evi / nbr / ndmi / bsi
    """
    try:
        import mercantile
        import rasterio
        from rasterio.warp import transform_bounds
        from rasterio.windows import from_bounds
    except ImportError as exc:
        raise RuntimeError("rasterio/mercantile not installed") from exc
    from PIL import Image

    band_index = INDEX_BAND.get(layer)
    if band_index is None:
        raise ValueError(f"Unknown index layer: {layer!r}")

    path = _find_raster(region, year)
    tile_bounds = mercantile.bounds(x, y, z)
    src = _open_raster(path)

    src_bounds = transform_bounds(
        "EPSG:4326", src.crs,
        tile_bounds.west, tile_bounds.south, tile_bounds.east, tile_bounds.north,
        densify_pts=21,
    )
    window = from_bounds(*src_bounds, transform=src.transform).intersection(
        rasterio.windows.Window(0, 0, src.width, src.height)
    )
    if window.width <= 0 or window.height <= 0:
        return _empty_png()

    # Use overview if available (COG-aware)
    data = src.read(
        band_index,
        window=window,
        out_shape=(256, 256),
        out_dtype="float32",
        boundless=True,
        fill_value=np.nan,
        resampling=rasterio.enums.Resampling.bilinear,
    )
    vmin, vmax = INDEX_RANGE[layer]
    rgba = _index_to_rgba(data, vmin, vmax, layer)
    return _rgba_to_png(rgba)


def render_classification_tile(
    class_map: np.ndarray,
    src_transform: Any,
    src_crs: Any,
    palette: dict,
    z: int,
    x: int,
    y: int,
) -> bytes:
    """Render a categorical 256×256 RGBA PNG from an in-memory classification array."""
    try:
        import mercantile
        import rasterio
        from rasterio.transform import from_bounds as transform_from_bounds
        from rasterio.warp import reproject, Resampling
    except ImportError as exc:
        raise RuntimeError("rasterio/mercantile not installed") from exc
    from PIL import Image

    tile_bounds = mercantile.bounds(x, y, z)
    # Build a target transform for the 256×256 tile
    dst_transform = transform_from_bounds(
        tile_bounds.west, tile_bounds.south, tile_bounds.east, tile_bounds.north,
        256, 256,
    )
    dst = np.full((256, 256), 255, dtype=np.uint8)  # 255 = nodata
    try:
        reproject(
            source=class_map.astype(np.uint8),
            destination=dst,
            src_transform=src_transform,
            src_crs=src_crs,
            dst_transform=dst_transform,
            dst_crs="EPSG:4326",
            resampling=Resampling.nearest,
            src_nodata=255,
            dst_nodata=255,
        )
    except Exception:
        pass
    rgba = _categorical_to_rgba(dst, palette)
    return _rgba_to_png(rgba)


def _empty_png() -> bytes:
    from PIL import Image
    buf = BytesIO()
    Image.new("RGBA", (256, 256), (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def _rgba_to_png(rgba: np.ndarray) -> bytes:
    from PIL import Image
    buf = BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()
