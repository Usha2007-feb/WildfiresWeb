"""
Fetch forest/protected area boundary polygons from OpenStreetMap Overpass API
for encroachment detection case studies.
"""
import urllib.request
import urllib.parse
import json
import time
import os

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "gis", "boundaries")
os.makedirs(OUTPUT_DIR, exist_ok=True)

REGIONS = {
    "laisong": {
        "queries": [
            '[out:json][timeout:25];relation["name"~"Laisong",i];out geom;',
            '[out:json][timeout:25];(way["name"~"Laisong",i];node["name"~"Laisong",i];);out geom;'
        ],
        "bbox": [25.75, 92.85, 25.95, 93.05],
        "center": [25.84, 92.91]
    },
    "corbett": {
        "queries": [
            '[out:json][timeout:30];relation["name"~"Corbett",i]["boundary"="protected_area"];out geom;',
            '[out:json][timeout:30];relation["name"="Jim Corbett National Park"];out geom;'
        ],
        "bbox": [29.3, 79.0, 29.6, 79.6],
        "center": [29.45, 79.25]
    },
    "jyotikuchi": {
        "queries": [
            '[out:json][timeout:25];(relation["name"~"Jyotikuchi",i];way["name"~"Jyotikuchi",i];node["name"~"Jyotikuchi",i];);out geom;',
            '[out:json][timeout:25];(relation["name"~"Rani",i]["boundary"="protected_area"];);out geom;'
        ],
        "bbox": [26.1, 91.5, 26.3, 91.8],
        "center": [26.18, 91.65]
    },
    "similipal": {
        "queries": [
            '[out:json][timeout:30];relation["name"~"Similipal",i]["boundary"="protected_area"];out geom;',
            '[out:json][timeout:30];relation["name"="Similipal National Park"];out geom;'
        ],
        "bbox": [21.4, 85.7, 22.2, 86.8],
        "center": [21.8, 86.25]
    }
}


def query_overpass(query_str):
    data = urllib.parse.urlencode({"data": query_str}).encode("utf-8")
    req = urllib.request.Request(
        OVERPASS_URL,
        data=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "WildfireWebBot/1.0"
        }
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        return json.loads(resp.read())


def osm_to_geojson(elements, region_name, bbox, center):
    features = []

    for el in elements:
        el_type = el.get("type")
        tags = el.get("tags", {})
        name = tags.get("name", el_type + "_" + str(el.get("id", "")))
        props = {
            "osm_id": el.get("id"),
            "name": name,
            "osm_type": el_type,
            "layer_type": "boundary",
            **{k: v for k, v in tags.items()}
        }

        if el_type == "node" and "lat" in el and "lon" in el:
            features.append({
                "type": "Feature",
                "properties": {**props, "layer_type": "landmark"},
                "geometry": {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
            })

        elif el_type == "way" and "geometry" in el:
            coords = [[g["lon"], g["lat"]] for g in el["geometry"]]
            if len(coords) >= 3 and coords[0] == coords[-1]:
                features.append({
                    "type": "Feature",
                    "properties": props,
                    "geometry": {"type": "Polygon", "coordinates": [coords]}
                })
            elif len(coords) >= 2:
                features.append({
                    "type": "Feature",
                    "properties": props,
                    "geometry": {"type": "LineString", "coordinates": coords}
                })

        elif el_type == "relation" and "members" in el:
            outer_rings = []
            for member in el.get("members", []):
                if member.get("role") == "outer" and member.get("type") == "way":
                    coords = [[g["lon"], g["lat"]] for g in member.get("geometry", [])]
                    if len(coords) >= 3:
                        if coords[0] != coords[-1]:
                            coords.append(coords[0])
                        outer_rings.append(coords)

            if outer_rings:
                geom_type = "Polygon" if len(outer_rings) == 1 else "MultiPolygon"
                geometry = {
                    "type": geom_type,
                    "coordinates": [outer_rings[0]] if geom_type == "Polygon" else [[r] for r in outer_rings]
                }
                features.append({
                    "type": "Feature",
                    "properties": {**props, "layer_type": "protected_area"},
                    "geometry": geometry
                })

    # If no features found, create a bounding box polygon as placeholder
    if not features:
        min_lat, min_lon, max_lat, max_lon = bbox
        placeholder = {
            "type": "Feature",
            "properties": {
                "name": f"{region_name.title()} Region (Approximate Boundary)",
                "layer_type": "protected_area",
                "note": "Approximate boundary — replace with official data from ISRO Bhuvan/FSI"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [min_lon, min_lat], [max_lon, min_lat],
                    [max_lon, max_lat], [min_lon, max_lat],
                    [min_lon, min_lat]
                ]]
            }
        }
        features.append(placeholder)

    return {
        "type": "FeatureCollection",
        "name": f"{region_name.title()} Forest Boundary",
        "center": center,
        "features": features
    }


def main():
    print("=" * 60)
    print("Fetching forest boundary data from OpenStreetMap...")
    print("=" * 60)

    results = {}

    for region, info in REGIONS.items():
        print(f"\n[{region.upper()}]")
        elements = []

        for i, query in enumerate(info["queries"]):
            try:
                print(f"  Query {i+1}...", end=" ", flush=True)
                data = query_overpass(query)
                found = data.get("elements", [])
                print(f"{len(found)} elements")
                elements.extend(found)
                if found:
                    break  # Use first successful query
            except Exception as e:
                print(f"FAILED: {e}")
            time.sleep(2)

        geojson = osm_to_geojson(elements, region, info["bbox"], info["center"])
        out_path = os.path.join(OUTPUT_DIR, f"{region}_boundary.geojson")
        with open(out_path, "w") as f:
            json.dump(geojson, f, indent=2)

        feature_count = len(geojson["features"])
        results[region] = {"features": feature_count, "path": out_path}
        print(f"  -> Saved: {out_path} ({feature_count} features)")
        time.sleep(2)

    print("\n" + "=" * 60)
    print("SUMMARY:")
    for region, info in results.items():
        status = "OK" if info["features"] > 1 else "PLACEHOLDER (needs official data)"
        print(f"  {region:15s} -> {info['features']} features | {status}")
    print("=" * 60)
    print("\nNote: For accurate encroachment detection, replace placeholders")
    print("with official shapefile data from:")
    print("  - ISRO Bhuvan: https://bhuvan.nrsc.gov.in")
    print("  - Forest Survey of India: https://fsi.nic.in")
    print("  - WLDB: https://wldb.iwmi.org")


if __name__ == "__main__":
    main()
