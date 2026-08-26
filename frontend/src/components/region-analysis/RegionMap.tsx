"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAppStore } from "@/stores/appStore";

interface Props {
  regionId: string;
  center: [number, number];
  bounds: L.LatLngBoundsExpression;
}

// Layer type for toggling
type LayerKey = "boundary" | "geofence" | "water" | "buildings" | "locations";

const LAYER_LABELS: Record<LayerKey, string> = {
  boundary: "Boundary",
  geofence: "Geo-Fence Zones",
  water: "Water Bodies",
  buildings: "Infrastructure",
  locations: "Landmarks",
};

export default function RegionMap({ regionId, center, bounds }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const rectRef = useRef<L.Rectangle | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const initialized = useRef(false);

  // Layer refs
  const boundaryLayer = useRef<L.GeoJSON | null>(null);
  const geofenceLayer = useRef<L.LayerGroup | null>(null);
  const waterLayer = useRef<L.LayerGroup | null>(null);
  const buildingsLayer = useRef<L.LayerGroup | null>(null);
  const locationsLayer = useRef<L.LayerGroup | null>(null);


  const [visibleLayers, setVisibleLayers] = useState<Record<LayerKey, boolean>>({
    boundary: true,
    geofence: true,
    water: true,
    buildings: true,
    locations: true,
  });
  const [noFeatureWarning, setNoFeatureWarning] = useState(false);

  // --- Map init (once) ---
  useEffect(() => {
    if (!container.current || initialized.current) return;
    initialized.current = true;

    const map = L.map(container.current, {
      center, zoom: 12,
      zoomControl: true, attributionControl: false,
      scrollWheelZoom: true,
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Esri, Maxar, Earthstar Geographics", maxZoom: 19 }
    ).addTo(map);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "OSM", maxZoom: 19, opacity: 0.35,
    }).addTo(map);

    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });

    markerRef.current = L.circleMarker(center, {
      radius: 8, color: "#F97316", fillColor: "#F97316", fillOpacity: 0.35, weight: 3,
    }).addTo(map);

    const triggerPrediction = (
      lat: number,
      lon: number,
      featureName?: string,
      featureType?: string
    ) => {
      // Single atomic state update to avoid intermediate render where
      // predictionMode=true but selectedPoint=null (or vice-versa)
      useAppStore.setState({
        predictionMode: true,
        selectedPoint: { lat, lon, featureName, featureType },
      });
    };

    map.on("click", (e: L.LeafletMouseEvent) => {
      triggerPrediction(e.latlng.lat, e.latlng.lng);
    });

    // Expose helper on the map instance so layer effects can reuse it
    (map as any)._triggerPrediction = triggerPrediction;

    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.selectedPoint && markerRef.current) {
        markerRef.current.setLatLng([state.selectedPoint.lat, state.selectedPoint.lon]);
        markerRef.current.setStyle({ opacity: 1, fillOpacity: 0.35 });
      } else if (markerRef.current) {
        // Fallback to center if no point selected? Or just hide it? 
        // Let's just keep it at center but hide it if they close the modal.
        markerRef.current.setStyle({ opacity: 0, fillOpacity: 0 });
      }
    });

    mapRef.current = map;

    return () => {
      unsubscribe();
      map.remove();
      mapRef.current = null;
      initialized.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Load boundary layer ---
  useEffect(() => {
    if (!mapRef.current) return;

    if (boundaryLayer.current) {
      mapRef.current.removeLayer(boundaryLayer.current);
      boundaryLayer.current = null;
    }

    console.log(`[RegionMap] Loading boundary for region: ${regionId}`);

    fetch("/forestReserves.geojson")
      .then((r) => r.json())
      .then((data) => {
        const filtered = (data.features as any[]).filter(
          (f: any) => f?.properties?.id === regionId
        );
        console.log(`[RegionMap] GeoJSON features found for "${regionId}": ${filtered.length}`);

        if (filtered.length === 0) {
          setNoFeatureWarning(true);
        } else {
          setNoFeatureWarning(false);
        }
      })
      .catch((err) => console.error(err));
  }, [regionId]);

  // --- Load geo-fence zones ---
  useEffect(() => {
    if (!mapRef.current) return;

    if (geofenceLayer.current) {
      mapRef.current.removeLayer(geofenceLayer.current);
      geofenceLayer.current = null;
    }

    fetch("/gis/geo_fence_zones.geojson")
      .then((r) => r.json())
      .then((data) => {
        const group = L.layerGroup();

        const ZONE_STYLES: Record<string, { color: string; fill: string; opacity: number }> = {
          core_zone: { color: "#DC2626", fill: "#EF4444", opacity: 0.18 },
          buffer_zone: { color: "#F59E0B", fill: "#FCD34D", opacity: 0.12 },
          eco_sensitive_zone: { color: "#10B981", fill: "#34D399", opacity: 0.1 },
        };

        const filtered = (data.features as any[]).filter(
          (f: any) => f?.properties?.region_id === regionId
        );

        filtered.forEach((feature: any) => {
          const zoneType = feature.properties?.zone_type || "buffer_zone";
          const style = ZONE_STYLES[zoneType] || ZONE_STYLES.buffer_zone;

          const layer = L.geoJSON(feature as any, {
            style: () => ({
              color: style.color,
              weight: 2,
              fillColor: style.fill,
              fillOpacity: style.opacity,
              dashArray: zoneType === "core_zone" ? "" : "4 4",
            }),
          });
          layer.bindTooltip(feature.properties?.name || zoneType, {
            permanent: false,
            direction: "center",
          });
          layer.on("click", (e: any) => {
            L.DomEvent.stopPropagation(e);
            const trigger = (mapRef.current as any)?._triggerPrediction;
            if (trigger) trigger(e.latlng.lat, e.latlng.lng);
          });
          layer.addTo(group);
        });

        if (visibleLayers.geofence) group.addTo(mapRef.current!);
        geofenceLayer.current = group;
      })
      .catch((err) => console.warn("[RegionMap] Geo-fence zones not found:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId]);

  // --- Load rich region-specific layers ---
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing sub-layers
    [waterLayer, buildingsLayer, locationsLayer].forEach((ref) => {
      if (ref.current) mapRef.current?.removeLayer(ref.current);
      ref.current = null;
    });

    const wGroup = L.layerGroup();
    const bGroup = L.layerGroup();
    const lGroup = L.layerGroup();

    fetch(`/gis/${regionId}_layers.geojson`)
      .then((r) => r.json())
      .then((data) => {
        console.log(`[RegionMap] Loaded ${regionId}_layers.geojson: ${data.features?.length || 0} features`);

        (data.features as any[]).forEach((feature: any) => {
          const type = feature.properties?.layer_type as string;
          const name = feature.properties?.name || "";
          const geomType = feature.geometry?.type;

          if (type === "water") {
            const layer = L.geoJSON(feature as any, {
              style: () => ({
                color: "#2563EB",
                weight: 2,
                fillColor: "#60A5FA",
                fillOpacity: 0.3,
              }),
              pointToLayer: (_f, latlng) =>
                L.circleMarker(latlng, { radius: 6, color: "#2563EB", fillColor: "#60A5FA", fillOpacity: 0.7, weight: 2 }),
              onEachFeature: (_feat, sublayer) => {
                sublayer.on("click", (e: any) => {
                  L.DomEvent.stopPropagation(e);
                  const trigger = (mapRef.current as any)?._triggerPrediction;
                  if (trigger) trigger(e.latlng.lat, e.latlng.lng, name, type);
                });
              }
            });
            if (name) layer.bindTooltip(`💧 ${name}`, { permanent: false });
            layer.addTo(wGroup);
          } else if (type === "building" || type === "road") {
            const layer = L.geoJSON(feature as any, {
              style: () => ({
                color: "#78350F",
                weight: type === "road" ? 2 : 1,
                fillColor: "#FCD34D",
                fillOpacity: 0.25,
                dashArray: type === "road" ? "4 3" : undefined,
              }),
              pointToLayer: (_f, latlng) =>
                L.circleMarker(latlng, { radius: 5, color: "#78350F", fillColor: "#FCD34D", fillOpacity: 0.8, weight: 2 }),
              onEachFeature: (_feat, sublayer) => {
                sublayer.on("click", (e: any) => {
                  L.DomEvent.stopPropagation(e);
                  const trigger = (mapRef.current as any)?._triggerPrediction;
                  if (trigger) trigger(e.latlng.lat, e.latlng.lng, name, type);
                });
              }
            });
            if (name) layer.bindTooltip(`🏗 ${name}`, { permanent: false });
            layer.addTo(bGroup);
          } else if (type === "landmark" || type === "entry_point" || type === "watchtower" || type === "office") {
            const icons: Record<string, string> = {
              entry_point: "🚧",
              watchtower: "🗼",
              office: "🏢",
              landmark: "📍",
            };
            const emoji = icons[type] || "📍";

            const icon = L.divIcon({
              html: `<div style="font-size:18px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4))">${emoji}</div>`,
              className: "",
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            });

            if (geomType === "Point") {
              const coords: [number, number] = [
                feature.geometry.coordinates[1],
                feature.geometry.coordinates[0],
              ];
              const marker = L.marker(coords, { icon });
              if (name) marker.bindTooltip(name, { permanent: false, direction: "top", offset: [0, -14] });
              marker.on("click", (e: any) => {
                L.DomEvent.stopPropagation(e);
                const trigger = (mapRef.current as any)?._triggerPrediction;
                if (trigger) trigger(e.latlng.lat, e.latlng.lng, name, type);
              });
              marker.addTo(lGroup);
            }
          }
        });

        waterLayer.current = wGroup;
        buildingsLayer.current = bGroup;
        locationsLayer.current = lGroup;

        if (visibleLayers.water) wGroup.addTo(mapRef.current!);
        if (visibleLayers.buildings) bGroup.addTo(mapRef.current!);
        if (visibleLayers.locations) lGroup.addTo(mapRef.current!);
      })
      .catch((err) => console.warn(`[RegionMap] No layer file for ${regionId}:`, err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId]);

  // --- Toggle layer visibility ---
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const refs: Record<LayerKey, React.MutableRefObject<L.Layer | null>> = {
      boundary: boundaryLayer,
      geofence: geofenceLayer,
      water: waterLayer,
      buildings: buildingsLayer,
      locations: locationsLayer,
    };

    (Object.keys(visibleLayers) as LayerKey[]).forEach((key) => {
      const layer = refs[key].current;
      if (!layer) return;
      if (visibleLayers[key]) {
        if (!map.hasLayer(layer)) map.addLayer(layer);
      } else {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      }
    });
  }, [visibleLayers]);

  const toggleLayer = (key: LayerKey) => {
    setVisibleLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full rounded-2xl" />

      {/* Layer Toggle Panel */}
      <div className="absolute top-4 right-4 z-[500] rounded-xl bg-white/95 backdrop-blur-md p-3 shadow-lg ring-1 ring-slate-200/80 space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Map Layers</p>
        {(Object.keys(LAYER_LABELS) as LayerKey[]).map((key) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer group">
            <div
              onClick={() => toggleLayer(key)}
              className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-all cursor-pointer ${
                visibleLayers[key]
                  ? "bg-blue-600 border-blue-600"
                  : "bg-white border-slate-300"
              }`}
            >
              {visibleLayers[key] && (
                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span className="text-[11px] text-slate-600 group-hover:text-slate-900 transition-colors select-none">
              {LAYER_LABELS[key]}
            </span>
          </label>
        ))}
      </div>

      {/* No boundary warning */}
      {noFeatureWarning && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[500] rounded-lg bg-amber-50 ring-1 ring-amber-200 px-4 py-2 text-[12px] text-amber-700 font-medium shadow">
          ⚠️ Boundary polygon loading — map centred on region coordinates
        </div>
      )}
    </div>
  );
}
