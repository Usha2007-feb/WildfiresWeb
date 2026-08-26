"""Free Earth Engine downloader for compact change-detection products.

Downloads five derived index bands (NDVI, EVI, NBR, NDMI, BSI) in small
tiles using ``getDownloadURL``. It intentionally avoids Cloud Storage and
does not require a billing account. The local files are merged into one
GeoTIFF per region/year for the API.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import ee
import requests
import rasterio
from rasterio.merge import merge

ROOT = Path(__file__).resolve().parents[1]
BOUNDARY_DIR = ROOT / "frontend" / "public" / "gis" / "boundaries"
OUTPUT_DIR = ROOT / "data" / "imagery"


def boundary(name: str):
    with (BOUNDARY_DIR / f"{name}_boundary.geojson").open(encoding="utf-8") as handle:
        return ee.FeatureCollection(json.load(handle)).geometry()


def indexed_image(region, year: int):
    start, end = f"{year}-01-01", f"{year + 1}-01-01"
    if year < 2015:
        collection = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2").filterBounds(region).filterDate(start, end).filter(ee.Filter.lt("CLOUD_COVER", 60))
        def mask(image):
            qa = image.select("QA_PIXEL")
            clear = qa.bitwiseAnd(1 << 1).eq(0).And(qa.bitwiseAnd(1 << 3).eq(0)).And(qa.bitwiseAnd(1 << 4).eq(0))
            return image.updateMask(clear).multiply(0.0000275).add(-0.2).select(["SR_B1", "SR_B3", "SR_B4", "SR_B5", "SR_B7"], ["blue", "red", "nir", "swir1", "swir2"])
        scale = 30
    else:
        collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(region).filterDate(start, end).filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 50))
        def mask(image):
            scl = image.select("SCL")
            bad = scl.eq(3).Or(scl.eq(8)).Or(scl.eq(9)).Or(scl.eq(10)).Or(scl.eq(11))
            qa = image.select("QA60")
            clear = qa.bitwiseAnd(1 << 10).eq(0).And(qa.bitwiseAnd(1 << 11).eq(0))
            return image.updateMask(bad.Not()).updateMask(clear).multiply(0.0001).select(["B2", "B4", "B8", "B11", "B12"], ["blue", "red", "nir", "swir1", "swir2"])
        scale = 20
    def indices(image):
        ndvi = image.normalizedDifference(["nir", "red"]).rename("NDVI")
        nbr = image.normalizedDifference(["nir", "swir2"]).rename("NBR")
        ndmi = image.normalizedDifference(["nir", "swir1"]).rename("NDMI")
        evi = image.expression("2.5 * (nir-red) / (nir + 6*red - 7.5*blue + 1)", {"nir": image.select("nir"), "red": image.select("red"), "blue": image.select("blue")}).rename("EVI")
        bsi = image.expression("((swir1+red)-(nir+blue))/((swir1+red)+(nir+blue))", {"swir1": image.select("swir1"), "red": image.select("red"), "nir": image.select("nir"), "blue": image.select("blue")}).rename("BSI")
        return ee.Image.cat([ndvi, evi, nbr, ndmi, bsi])
    # Composite the masked reflectance bands first, then calculate indices
    # once. Calculating five expressions for every source scene can exceed
    # Earth Engine's user-memory limit even for a small tile.
    composite = collection.map(mask).median()
    return indices(composite).clip(region), scale


def download_tile(image, region, output: Path, scale: int, tile: int):
    if output.exists() and output.stat().st_size > 1_000_000:
        print(f"skip tile {tile}: {output.name} already exists")
        return
    # getDownloadURL requires client-side GeoJSON coordinates, unlike batch
    # Export tasks which accept a server-side ee.Geometry directly.
    region_coordinates = region.getInfo()["coordinates"]
    url = image.getDownloadURL({"name": output.stem, "region": region_coordinates, "scale": scale, "format": "GEO_TIFF", "bands": ["NDVI", "EVI", "NBR", "NDMI", "BSI"]})
    for attempt in range(1, 4):
        try:
            response = requests.get(url, timeout=180)
            if response.ok:
                break
            if attempt == 3:
                raise RuntimeError(f"Earth Engine download failed for tile {tile} ({response.status_code}): {response.text[:1000]}")
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(5 * attempt)
    output.write_bytes(response.content)
    print(f"downloaded tile {tile}: {output.name} ({len(response.content) / 1024 / 1024:.1f} MB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--regions", default="laisong,corbett,jyotikuchi,similipal")
    parser.add_argument("--years", default="2019,2023")
    args = parser.parse_args()
    ee.Initialize(project=args.project)
    for name in [item.strip() for item in args.regions.split(",") if item.strip()]:
        for year in [int(item) for item in args.years.split(",") if item.strip()]:
            study_region = boundary(name)
            # Similipal covers a much larger extent; use smaller free-download
            # tiles to stay below Earth Engine's 50 MB request limit.
            grid = 8 if name == "similipal" else 2
            target = OUTPUT_DIR / name / str(year)
            target.mkdir(parents=True, exist_ok=True)
            coordinates = study_region.bounds().coordinates().getInfo()[0]
            xs, ys = [point[0] for point in coordinates], [point[1] for point in coordinates]
            west, east, south, north = min(xs), max(xs), min(ys), max(ys)
            tiles = []
            for row in range(grid):
                for column in range(grid):
                    tile_region = ee.Geometry.Rectangle([west + (east - west) * column / grid, south + (north - south) * row / grid, west + (east - west) * (column + 1) / grid, south + (north - south) * (row + 1) / grid])
                    tile_path = target / f".tile_{row}_{column}.tif"
                    # Build the annual composite inside the tile itself. This
                    # avoids materialising the whole reserve in EE memory.
                    tile_image, scale = indexed_image(tile_region, year)
                    download_tile(tile_image, tile_region, tile_path, scale, row * grid + column + 1)
                    tiles.append(tile_path)
            sources = [rasterio.open(path) for path in tiles]
            mosaic, transform = merge(sources)
            profile = sources[0].profile.copy()
            profile.update(driver="GTiff", height=mosaic.shape[1], width=mosaic.shape[2], transform=transform, count=5, compress="deflate", tiled=True)
            with rasterio.open(target / f"{name}_{year}_indices.tif", "w", **profile) as destination:
                destination.write(mosaic)
            for source in sources:
                source.close()
            for path in tiles:
                path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
