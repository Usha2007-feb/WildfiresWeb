"""Convert local index GeoTIFFs to Cloud-Optimised GeoTIFF (COG) format.

COGs add internal tiling and multi-resolution overviews so that the tile
server can serve 256×256 PNG tiles with a single, small rasterio windowed
read instead of decoding the entire file.  Run this once after downloading
new imagery.

Usage
-----
    python scripts/convert_to_cog.py
    python scripts/convert_to_cog.py --regions laisong corbett
    python scripts/convert_to_cog.py --workers 4
"""
from __future__ import annotations

import argparse
import concurrent.futures
import logging
import shutil
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
IMAGERY_DIR = ROOT / "data" / "imagery"
ALL_REGIONS = ("laisong", "corbett", "jyotikuchi", "similipal")

# Overview levels — 2×, 4×, 8×, 16× downsampling
OVERVIEW_FACTORS = [2, 4, 8, 16]


def _convert_one(src_path: Path) -> Path:
    """Rewrite *src_path* as a tiled+compressed GeoTIFF in-place.

    For files smaller than 300 MB the whole array is read at once.
    For larger files (e.g. Similipal 733 MB) bands are written one at a time
    to keep peak RAM below 2× the single-band size.
    """
    try:
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.shutil import copy as rio_copy
    except ImportError as exc:
        raise SystemExit("rasterio is required — pip install rasterio") from exc

    file_mb = src_path.stat().st_size / (1024 * 1024)
    # Overview factors scaled to available RAM; skip for very large files.
    factors = [] if file_mb > 300 else ([2, 4] if file_mb > 100 else OVERVIEW_FACTORS)

    tmp_path = src_path.with_suffix(".cog_tmp.tif")
    try:
        with rasterio.open(src_path) as src:
            profile = src.profile.copy()
            profile.update(
                driver="GTiff",
                tiled=True,
                blockxsize=256,
                blockysize=256,
                compress="deflate",
                predictor=2,
                zlevel=5,        # slightly lower = less RAM pressure
                interleave="band",
            )

            # Stream band-by-band to stay within RAM for large images
            with rasterio.open(tmp_path, "w", **profile) as dst:
                for band_idx in range(1, src.count + 1):
                    band_data = src.read(band_idx)
                    dst.write(band_data, band_idx)
                    del band_data   # release immediately

                if factors:
                    try:
                        dst.build_overviews(factors, Resampling.average)
                        dst.update_tags(ns="rio_overview", resampling="average")
                    except Exception as ov_err:
                        log.warning(
                            "Overviews skipped for %s: %s",
                            src_path.name, ov_err,
                        )

        # Copy with COPY_SRC_OVERVIEWS=YES for final COG layout
        cog_path = src_path.with_suffix(".cog.tif")
        rio_copy(
            tmp_path,
            cog_path,
            driver="GTiff",
            copy_src_overviews=True,
            tiled=True,
            blockxsize=256,
            blockysize=256,
            compress="deflate",
            predictor=2,
            zlevel=5,
        )
        src_path.unlink()
        cog_path.rename(src_path)
        log.info("COG  %-58s  OK (%.0f MB)", src_path.relative_to(ROOT), file_mb)
        return src_path

    finally:
        tmp_path.unlink(missing_ok=True)


def find_tifs(regions: list[str]) -> list[Path]:
    paths: list[Path] = []
    for region in regions:
        region_dir = IMAGERY_DIR / region
        if not region_dir.exists():
            log.warning("No imagery directory for %s — skipping", region)
            continue
        for tif in sorted(region_dir.rglob("*.tif")):
            if tif.stem.startswith("."):
                continue
            paths.append(tif)
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--regions",
        nargs="+",
        default=list(ALL_REGIONS),
        choices=list(ALL_REGIONS),
        help="Regions to convert (default: all)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=2,
        help="Parallel conversion jobs (default: 2; Similipal is large so keep low)",
    )
    args = parser.parse_args()

    tifs = find_tifs(args.regions)
    if not tifs:
        log.error("No GeoTIFF files found. Download imagery first.")
        sys.exit(1)

    log.info("Converting %d GeoTIFF(s) to COG with %d worker(s)…", len(tifs), args.workers)

    errors: list[tuple[Path, Exception]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(_convert_one, path): path for path in tifs}
        for future in concurrent.futures.as_completed(futures):
            path = futures[future]
            try:
                future.result()
            except Exception as exc:
                log.error("FAILED %s: %s", path, exc)
                errors.append((path, exc))

    if errors:
        log.error("%d conversion(s) failed.", len(errors))
        sys.exit(1)
    else:
        log.info("All conversions complete.")


if __name__ == "__main__":
    main()
