"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/constants";

interface ZoneFeature {
  id: number; name: string; type: string; state?: string; area_ha?: number;
  geojson: string; color: string; metadata: Record<string, unknown>;
}

interface Props {
  onZonesLoaded: (zones: ZoneFeature[]) => void;
  onZoneClick: (zone: ZoneFeature) => void;
  hiddenTypes: Set<string>;
}

const TYPE_LABELS: Record<string, string> = {
  reserve: "Reserve", buffer_zone: "Buffer Zone", core_forest: "Core Forest",
  eco_sensitive: "Eco-Sensitive", beat_boundary: "Beat Boundary", compartment: "Compartment",
};

export default function GISZoneMap({ onZonesLoaded, onZoneClick, hiddenTypes }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Map<number, L.GeoJSON>>(new Map());

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
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "OSM", maxZoom: 19, opacity: 0.3,
    }).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
    mapRef.current = map;

    fetch(api("/api/v1/gis/map-data"))
      .then((r) => (r.ok ? r.json() : []))
      .then((zones: ZoneFeature[]) => {
        onZonesLoaded(zones);
        const m = new Map<number, L.GeoJSON>();
        zones.forEach((z) => {
          try {
            const layer = L.geoJSON(JSON.parse(z.geojson) as never, {
              style: {
                color: z.color, weight: z.type === "reserve" ? 3 : z.type === "core_forest" ? 2.5 : 1.5,
                fillColor: z.color, fillOpacity: z.type === "reserve" ? 0.18 : z.type === "core_forest" ? 0.12 : 0.08,
                dashArray: z.type === "buffer_zone" ? "6 3" : z.type === "eco_sensitive" ? "4 4" : undefined,
              },
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

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const m = layersRef.current;
    if (m.size === 0) return;
    m.forEach((layer, id) => {
      const z = (layer as L.GeoJSON & { _zoneType?: string });
      const feature = layer.getLayers()[0];
      if (!feature || !("feature" in feature)) return;
      const props = (feature as { feature?: { properties?: Record<string, string> } }).feature?.properties;
      if (!props?.type) return;
      if (hiddenTypes.has(props.type)) {
        mapRef.current?.removeLayer(layer);
      } else if (!mapRef.current?.hasLayer(layer)) {
        mapRef.current?.addLayer(layer);
      }
    });
  }, [hiddenTypes]);

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}
