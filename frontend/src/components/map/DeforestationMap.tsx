"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/constants";

interface ZoneFeature { id: number; name: string; type: string; state?: string; geojson: string; ndvi_change: number; cover_change: number; trend: string; color: string }

interface Props {
  onZonesLoaded: (zones: ZoneFeature[]) => void;
  onZoneClick: (zone: ZoneFeature) => void;
  onRectDraw: (swLat: number, swLng: number, neLat: number, neLng: number) => void;
  drawMode: boolean;
  onDrawEnd: () => void;
}

export default function DeforestationMap({ onZonesLoaded, onZoneClick, onRectDraw, drawMode, onDrawEnd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const rectRef = useRef<L.Rectangle | null>(null);
  const persistentRect = useRef<L.Rectangle | null>(null);
  const drawStart = useRef<L.LatLng | null>(null);
  const drawModeRef = useRef(false);

  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [23.5, 80], zoom: 6,
      minZoom: 5, maxZoom: 18,
      zoomControl: true, attributionControl: false,
      scrollWheelZoom: true,
      maxBounds: L.latLngBounds([5.0, 65.0], [37.0, 100.0]),
      maxBoundsViscosity: 1.0,
    });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Esri, Maxar", maxZoom: 19,
    }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "OSM", maxZoom: 19, opacity: 0.35,
    }).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
    mapRef.current = map;

    fetch(api("/api/v1/deforestation/map-data"))
      .then((r) => (r.ok ? r.json() : []))
      .then((zones: ZoneFeature[]) => {
        const distinct = zones.filter((z) => z.type === "reserve");
        onZonesLoaded(distinct);
        distinct.forEach((z) => {
          try {
            const layer = L.geoJSON(z.geojson as never, {
              style: { color: z.color, weight: 3, fillColor: z.color, fillOpacity: 0.18 },
            });
            layer.bindTooltip(
              `<div style="font-family:Inter;font-size:12px;line-height:1.5">
                <b style="color:#1E293B;font-size:13px">${z.name}</b><br/>
                <span style="color:${z.color};font-weight:600">${z.trend} (${(z.ndvi_change*100).toFixed(1)}%)</span>
              </div>`,
              { direction: "top", sticky: true }
            );
            layer.on("click", () => onZoneClick(z));
            layer.addTo(map);
          } catch {}
        });
        if (distinct.length > 0) {
          const allBounds = L.latLngBounds([] as never);
          map.eachLayer((l) => { if (l instanceof L.GeoJSON) { try { allBounds.extend(l.getBounds()); } catch {} } });
          if (allBounds.isValid()) map.fitBounds(allBounds, { padding: [40, 40] });
        }
      });

    map.on("mousedown", (e: L.LeafletMouseEvent) => {
      if (!drawModeRef.current) return;
      L.DomEvent.preventDefault(e.originalEvent as Event);
      drawStart.current = e.latlng;
      map.dragging.disable();
    });
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      if (!drawModeRef.current || !drawStart.current) return;
      L.DomEvent.preventDefault(e.originalEvent as Event);
      if (rectRef.current) map.removeLayer(rectRef.current);
      rectRef.current = L.rectangle(L.latLngBounds(drawStart.current, e.latlng), {
        color: "#2563EB", weight: 2, fillColor: "#3B82F6", fillOpacity: 0.1, dashArray: "6 3",
      }).addTo(map);
    });
    map.on("mouseup", (e: L.LeafletMouseEvent) => {
      if (!drawModeRef.current || !drawStart.current) return;
      L.DomEvent.preventDefault(e.originalEvent as Event);
      map.dragging.enable();
      const bounds = L.latLngBounds(drawStart.current, e.latlng);
      if (bounds.isValid() && drawStart.current.distanceTo(e.latlng) > 10) {
        if (persistentRect.current) map.removeLayer(persistentRect.current);
        if (rectRef.current) map.removeLayer(rectRef.current);
        persistentRect.current = L.rectangle(bounds, {
          color: "#2563EB", weight: 2, fillColor: "#3B82F6", fillOpacity: 0.08, dashArray: "4 2",
        }).addTo(map);
        rectRef.current = null;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        onRectDraw(sw.lat, sw.lng, ne.lat, ne.lng);
      }
      drawStart.current = null;
      drawModeRef.current = false;
      onDrawEnd();
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}
