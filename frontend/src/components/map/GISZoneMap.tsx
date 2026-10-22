"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/constants";

interface ZoneFeature {
  id: number; name: string; type: string; state?: string; area_ha?: number;
  geojson: string; color: string; metadata: Record<string, unknown>;
}

interface POI {
  id: number; name: string; type: string; lat: number; lon: number;
  zone_id: number; zone_name: string; emoji: string; metadata: Record<string, unknown>;
}

interface Props {
  onZonesLoaded: (zones: ZoneFeature[]) => void;
  onZoneClick: (zone: ZoneFeature) => void;
  hiddenTypes: Set<string>;
  satelliteVisible: boolean;
  satelliteOpacity: number;
  showNDVI: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  reserve: "Reserve", buffer_zone: "Buffer Zone", core_forest: "Core Forest",
  eco_sensitive: "Eco-Sensitive", beat_boundary: "Beat", compartment: "Compartment",
};

const STROKE_WEIGHT: Record<string, number> = {
  reserve: 4, buffer_zone: 2, core_forest: 3, eco_sensitive: 2, beat_boundary: 1.5, compartment: 1,
};

const POI_LABELS: Record<string, string> = {
  guard_hub: "Forest Guard Hub", watchtower: "Fire Watchtower", water_source: "Water Source",
  fire_station: "Fire Station", camp: "Field Camp", checkpoint: "Checkpoint",
};

export default function GISZoneMap({ onZonesLoaded, onZoneClick, hiddenTypes, satelliteVisible, satelliteOpacity, showNDVI }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Map<number, L.GeoJSON>>(new Map());
  const poiMarkersRef = useRef<L.LayerGroup>(L.layerGroup());
  const satLayerRef = useRef<L.TileLayer | null>(null);
  const ndviLayerRef = useRef<L.TileLayer | null>(null);
  const [pois, setPois] = useState<POI[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [23.5, 80], zoom: 5,
      zoomControl: true, attributionControl: false,
      scrollWheelZoom: true,
    });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Esri, Maxar", maxZoom: 19,
    }).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Esri", maxZoom: 19 }
    ).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
    poiMarkersRef.current.addTo(map);
    mapRef.current = map;

    fetch(api("/api/v1/gis/map-data"))
      .then((r) => (r.ok ? r.json() : []))
      .then((zones: ZoneFeature[]) => {
        onZonesLoaded(zones);
        const m = new Map<number, L.GeoJSON>();
        // Sort: reserves first (render on top), then core, then others
        const order = ["reserve", "core_forest", "eco_sensitive", "buffer_zone", "beat_boundary", "compartment"];
        const sorted = [...zones].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
        sorted.forEach((z) => {
          try {
            const w = STROKE_WEIGHT[z.type] || 1;
            const d = z.type === "buffer_zone" ? "5 3" : z.type === "eco_sensitive" ? "4 4" : undefined;
            const layer = L.geoJSON(z.geojson as never, {
              style: { color: z.color, weight: w, fillColor: z.color, fillOpacity: 0.15, dashArray: d },
            });
            layer.bindTooltip(
              `<div style="font-family:Inter;font-size:12px;line-height:1.5;max-width:200px">
                <b style="color:#1E293B;font-size:13px">${z.name}</b><br/>
                <span style="color:#64748B">${TYPE_LABELS[z.type] || z.type} · ${z.state || ""}</span>
                ${z.area_ha ? `<br/><span style="color:#94A3B8;font-size:10px">${(z.area_ha / 1000).toFixed(1)}k ha</span>` : ""}
              </div>`,
              { direction: "top", sticky: true, opacity: 0.95 }
            );
            layer.on("click", () => onZoneClick(z));
            layer.addTo(map);
            m.set(z.id, layer);
          } catch {}
        });
        layersRef.current = m;
        if (zones.length > 0) {
          const b = L.latLngBounds([] as never);
          map.eachLayer((l) => { if (l instanceof L.GeoJSON) { try { b.extend(l.getBounds()); } catch {} } });
          if (b.isValid()) map.fitBounds(b, { padding: [40, 40] });
        }
      });

    fetch(api("/api/v1/gis/pois"))
      .then((r) => (r.ok ? r.json() : []))
      .then((data: POI[]) => {
        setPois(data);
        data.forEach((p) => {
          const icon = L.divIcon({
            html: `<div style="font-size:18px;text-align:center;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3))">${p.emoji}</div>`,
            className: "", iconSize: [24, 24], iconAnchor: [12, 12],
          });
          const marker = L.marker([p.lat, p.lon], { icon, zIndexOffset: 500 });
          marker.bindTooltip(
            `<div style="font-family:Inter;font-size:12px;line-height:1.5;max-width:180px">
              <b style="font-size:13px">${p.emoji} ${p.name}</b><br/>
              <span style="color:#64748B">${POI_LABELS[p.type] || p.type}</span><br/>
              <span style="color:#94A3B8;font-size:10px">${p.zone_name}</span>
              ${p.metadata?.contact ? `<br/><span style="color:#475569;font-size:10px">📞 ${p.metadata.contact}</span>` : ""}
              ${p.metadata?.staff ? `<br/><span style="color:#475569;font-size:10px">👥 ${p.metadata.staff} staff</span>` : ""}
            </div>`,
            { direction: "top", offset: [0, -12], opacity: 0.95 }
          );
          marker.addTo(poiMarkersRef.current);
        });
      });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const m = layersRef.current;
    if (m.size === 0) return;
    m.forEach((layer, id) => {
      const l0 = layer.getLayers()[0];
      if (!l0 || !("feature" in l0)) return;
      const props = (l0 as { feature?: { properties?: Record<string, string> } }).feature?.properties;
      if (!props?.type) return;
      if (hiddenTypes.has(props.type)) {
        mapRef.current?.removeLayer(layer);
      } else if (!mapRef.current?.hasLayer(layer)) {
        mapRef.current?.addLayer(layer);
      }
    });
  }, [hiddenTypes]);

  // Satellite layer toggle
  useEffect(() => {
    if (!mapRef.current) return;
    const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2025-07-01/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
    if (satelliteVisible) {
      if (!satLayerRef.current) {
        satLayerRef.current = L.tileLayer(url, { attribution: "NASA GIBS MODIS", opacity: satelliteOpacity, maxZoom: 14, zIndex: 1 }).addTo(mapRef.current);
      }
      if (satLayerRef.current) satLayerRef.current.setOpacity(satelliteOpacity);
    } else {
      if (satLayerRef.current) { mapRef.current.removeLayer(satLayerRef.current); satLayerRef.current = null; }
    }
  }, [satelliteVisible, satelliteOpacity]);

  // NDVI layer toggle
  useEffect(() => {
    if (!mapRef.current) return;
    if (showNDVI) {
      const date = "2025-07-01";
      if (!ndviLayerRef.current) {
        ndviLayerRef.current = L.tileLayer(
          `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
          { attribution: "NASA MODIS", opacity: 0.5, maxZoom: 14, zIndex: 2 }
        ).addTo(mapRef.current);
      }
    } else {
      if (ndviLayerRef.current) { mapRef.current.removeLayer(ndviLayerRef.current); ndviLayerRef.current = null; }
    }
  }, [showNDVI]);

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}
