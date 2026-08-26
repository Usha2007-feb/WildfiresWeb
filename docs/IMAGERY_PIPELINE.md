# Automated real imagery pipeline

`scripts/download_imagery.py` reads the repository boundary GeoJSON files directly and queues GeoTIFF exports to Google Drive through the Earth Engine Python API. No Earth Engine table uploads, Cloud Storage bucket, or billing setup are required.

## One-time setup

```powershell
cd C:\Users\vaast\Desktop\WILDFIRE_WEB
.\venv\Scripts\activate
pip install -r scripts\requirements-earthengine.txt
earthengine authenticate
earthengine set_project YOUR_PROJECT_ID
```

## Queue exports

```powershell
python scripts\download_imagery.py --project YOUR_PROJECT_ID --drive-folder wildfire_imagery --years 2011,2023
```

2011 automatically uses Landsat 7 at 30 m. Years from 2015 onward use Sentinel-2 at 20 m so the SWIR bands used by NBR, NDMI and BSI align with the other bands. Each export is cloud/shadow masked and contains blue, green, red, NIR, SWIR1 and SWIR2 reflectance bands. Use `--regions laisong,corbett` to limit the run, or add `--wait` to poll tasks until completion.

Exports are written to the `wildfire_imagery` folder in Google Drive. Submission records are stored in `data/imagery/manifest.json`. Existing task descriptions are skipped, so rerunning the command is safe.

After tasks complete, download the GeoTIFFs from Drive into `data/imagery/<region>/<year>/` (for example, `data/imagery/corbett/2019/corbett_2019_sentinel2.tif`). The API detects those files automatically and analyses the 2019 → 2023 pair for each case study.

### Free compact download (recommended for students)

This avoids Drive and Cloud Storage. Earth Engine computes the five indices first, then the script downloads four small tiles per region/year and merges them locally:

```powershell
.\venv\Scripts\python.exe scripts\download_indices_free.py --project YOUR_PROJECT_ID --regions corbett --years 2019,2023
```

Run the other regions after the test succeeds. It uses only the free Earth Engine download endpoint and does not require billing or a paid bucket.

## Local analysis API

Install the new raster dependency once, then restart the backend:

```powershell
.\venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

`GET /api/v1/encroachment/status` reports the years found locally. `GET /api/v1/encroachment/corbett/analysis?before=2019&after=2023` calculates NDVI, EVI, NBR, NDMI and BSI, performs a conservative forest/non-forest change test, and returns real GeoJSON candidates. The map requests `/api/v1/encroachment/<region>/imagery/<year>/{z}/{x}/{y}.png` to display those local GeoTIFFs for exported years; it falls back to the historical basemap only for years not exported. It deliberately reports no accuracy value until labelled validation polygons are available.
