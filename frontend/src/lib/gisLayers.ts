/**
 * GIS Layer type definitions and loader functions
 * for the four monitored forest regions.
 */

export type LayerType =
  | "water"
  | "building"
  | "road"
  | "landmark"
  | "entry_point"
  | "watchtower"
  | "office";

export type ZoneType = "core_zone" | "buffer_zone" | "eco_sensitive_zone";

export interface GISFeatureProperties {
  layer_type: LayerType;
  name?: string;
  category?: string;
}

export interface GeoFenceProperties {
  region_id: string;
  zone_type: ZoneType;
  name: string;
  management_unit?: string;
  area_sqkm?: number;
  protection_level?: "strict" | "moderate" | "low";
  description?: string;
}

export const REGION_LAYER_FILES: Record<string, string> = {
  corbett: "/gis/corbett_layers.geojson",
  similipal: "/gis/similipal_layers.geojson",
  jyotikuchi: "/gis/jyotikuchi_layers.geojson",
  laisong: "/gis/laisong_layers.geojson",
};

export const ZONE_STYLE: Record<ZoneType, { color: string; fill: string; opacity: number; label: string }> = {
  core_zone: {
    color: "#DC2626",
    fill: "#EF4444",
    opacity: 0.20,
    label: "Core Zone",
  },
  buffer_zone: {
    color: "#D97706",
    fill: "#FCD34D",
    opacity: 0.14,
    label: "Buffer Zone",
  },
  eco_sensitive_zone: {
    color: "#059669",
    fill: "#34D399",
    opacity: 0.10,
    label: "Eco-Sensitive Zone",
  },
};

export const LAYER_ICONS: Record<LayerType, string> = {
  water: "💧",
  building: "🏗",
  road: "🛤",
  landmark: "📍",
  entry_point: "🚧",
  watchtower: "🗼",
  office: "🏢",
};

export async function fetchGISLayers(regionId: string): Promise<GeoJSON.FeatureCollection | null> {
  const url = REGION_LAYER_FILES[regionId];
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn(`[GIS] Could not load layers for ${regionId}:`, e);
    return null;
  }
}

export async function fetchGeoFenceZones(): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const res = await fetch("/gis/geo_fence_zones.geojson");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn("[GIS] Could not load geo-fence zones:", e);
    return null;
  }
}

export async function fetchReserveBoundaries(): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const res = await fetch("/forestReserves.geojson");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn("[GIS] Could not load reserve boundaries:", e);
    return null;
  }
}
