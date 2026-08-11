"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { ZONE_STYLE, REGION_LAYER_FILES, type ZoneType } from "@/lib/gisLayers";
import { REGIONS } from "@/lib/regions";
import type { Alert } from "@/hooks/useAlerts";

type OverlayKey =
  | "boundaries"
  | "geofence"
  | "water"
  | "buildings"
  | "locations"
  | "alerts";

interface Props {
  activeRegion: string;
  visibleLayers: Record<OverlayKey, boolean>;
  onFeatureClick?: (props: Record<string, string>) => void;
  alerts?: Alert[];
  onAlertClick?: (alert: Alert) => void;
}

export default function GISPortalMap({ activeRegion, visibleLayers, onFeatureClick, alerts = [], onAlertClick }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const initialized = useRef(false);

  const layerRefs = useRef<Record<string, L.Layer | L.LayerGroup | null>>({
    boundaries: null,
    geofence: null,
    water: null,
    buildings: null,
    locations: null,
    alerts: null,
  });

  // ---- Map init ----
  useEffect(() => {
    if (!container.current || initialized.current) return;
    initialized.current = true;

    const map = L.map(container.current, {
      center: [24.0, 83.0],
      zoom: 5,
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: true,
    });

    // Satellite base layer
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Esri, Maxar, Earthstar Geographics", maxZoom: 19 }
    ).addTo(map);

    // Labels overlay
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
      opacity: 0.3,
    }).addTo(map);

    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);

    mapRef.current = map;

    // Load all region boundaries
    loadBoundaries(map);

    return () => {
      map.remove();
      mapRef.current = null;
      initialized.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Pan to active region ----
  useEffect(() => {
    if (!mapRef.current) return;
    const region = REGIONS.find((r) => r.id === activeRegion);
    if (!region) return;
    const bounds: L.LatLngBoundsExpression = [
      [region.bounds.lat_min, region.bounds.lon_min],
      [region.bounds.lat_max, region.bounds.lon_max],
    ];
    mapRef.current.flyToBounds(bounds, { padding: [40, 40], maxZoom: 13, duration: 1.2 });

    // Reload per-region layers
    loadRegionLayers(mapRef.current, activeRegion);
    loadGeoFence(mapRef.current, activeRegion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRegion]);

  // ---- Toggle layer visibility ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    (Object.keys(visibleLayers) as OverlayKey[]).forEach((key) => {
      const layer = layerRefs.current[key];
      if (!layer) return;
      if (visibleLayers[key]) {
        if (!map.hasLayer(layer)) map.addLayer(layer);
      } else {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      }
    });
  }, [visibleLayers]);

  // ---- Geo-fence fire alerts ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const previous = layerRefs.current.alerts;
    if (previous && map.hasLayer(previous)) map.removeLayer(previous);

    const group = L.markerClusterGroup({ maxClusterRadius: 40 });
    alerts.forEach((alert) => {
      const marker = L.circleMarker([alert.lat, alert.lon], {
        radius: 8,
        color: "#FFFFFF",
        weight: 2,
        fillColor: "#DC2626",
        fillOpacity: 0.95,
      });
      marker.bindTooltip(
        `<b>${alert.zone_name}</b><br/>FRP: ${alert.frp.toFixed(1)} MW · ${alert.date}`,
        { direction: "top", offset: [0, -8], permanent: false },
      );
      marker.on("click", () => onAlertClick?.(alert));
      marker.addTo(group);
    });

    layerRefs.current.alerts = group;
    if (visibleLayers.alerts) group.addTo(map);
  }, [alerts, onAlertClick, visibleLayers.alerts]);

  function loadBoundaries(map: L.Map) {
    fetch("/forestReserves.geojson")
      .then((r) => r.json())
      .then((data) => {
        const layer = L.geoJSON(data as never, {
          style: () => ({
            color: "#16A34A",
            weight: 2.5,
            fillColor: "#22C55E",
            fillOpacity: 0.12,
            dashArray: "6 3",
          }),
          onEachFeature: (feature: any, l) => {
            const p = feature.properties || {};
            l.bindTooltip(`<b>${p.name}</b><br/>${p.state} · ${p.area}`, {
              permanent: false,
              direction: "center",
            });
            l.on("click", () => onFeatureClick?.(p));
          },
        });
        if (visibleLayers.boundaries) layer.addTo(map);
        layerRefs.current.boundaries = layer;
      })
      .catch((e) => console.warn("[GISPortal] boundaries load error:", e));
  }

  function loadGeoFence(map: L.Map, regionId: string) {
    const prev = layerRefs.current.geofence;
    if (prev && map.hasLayer(prev)) map.removeLayer(prev);
    layerRefs.current.geofence = null;

    fetch("/gis/geo_fence_zones.geojson")
      .then((r) => r.json())
      .then((data) => {
        const group = L.layerGroup();
        const filtered = (data.features as any[]).filter(
          (f: any) => f?.properties?.region_id === regionId
        );

        filtered.forEach((feature: any) => {
          const zoneType = (feature.properties?.zone_type || "buffer_zone") as ZoneType;
          const style = ZONE_STYLE[zoneType] || ZONE_STYLE.buffer_zone;

          const l = L.geoJSON(feature as never, {
            style: () => ({
              color: style.color,
              weight: 2,
              fillColor: style.fill,
              fillOpacity: style.opacity,
              dashArray: zoneType === "core_zone" ? "" : "5 4",
            }),
          });
          l.bindTooltip(
            `<b>${feature.properties?.name || zoneType}</b><br/>${style.label} · ${
              feature.properties?.protection_level || ""
            }`,
            { permanent: false, direction: "center" }
          );
          l.on("click", () => onFeatureClick?.(feature.properties || {}));
          l.addTo(group);
        });

        layerRefs.current.geofence = group;
        if (visibleLayers.geofence) group.addTo(map);
      })
      .catch((e) => console.warn("[GISPortal] geofence load error:", e));
  }

  function loadRegionLayers(map: L.Map, regionId: string) {
    const clearAndSet = (
      key: "water" | "buildings" | "locations",
      group: L.LayerGroup
    ) => {
      const prev = layerRefs.current[key];
      if (prev && map.hasLayer(prev)) map.removeLayer(prev);
      layerRefs.current[key] = group;
      if (visibleLayers[key]) group.addTo(map);
    };

    const wGroup = L.layerGroup();
    const bGroup = L.layerGroup();
    const lGroup = L.markerClusterGroup({ maxClusterRadius: 50, spiderfyOnMaxZoom: true });

    fetch(`/gis/${regionId}_layers.geojson`)
      .then((r) => r.json())
      .then((data) => {
        (data.features as any[]).forEach((feature: any) => {
          const type = feature.properties?.layer_type as string;
          const name = feature.properties?.name || "";
          const geomType = feature.geometry?.type;

          if (type === "water") {
            const l = L.geoJSON(feature as never, {
              style: () => ({ color: "#2563EB", weight: 2, fillColor: "#60A5FA", fillOpacity: 0.3 }),
              pointToLayer: (_f, latlng) =>
                L.circleMarker(latlng, { radius: 6, color: "#2563EB", fillColor: "#60A5FA", fillOpacity: 0.7, weight: 2 }),
            });
            if (name) l.bindTooltip(`💧 ${name}`, { permanent: false, direction: "top", className: "bg-white/90 backdrop-blur-sm border-0 text-slate-700 text-xs font-medium px-2 py-1 shadow-sm rounded-md" });
            l.addTo(wGroup);
          } else if (type === "building" || type === "road") {
            const l = L.geoJSON(feature as never, {
              style: () => ({
                color: "#78350F",
                weight: type === "road" ? 2 : 1,
                fillColor: "#FCD34D",
                fillOpacity: 0.25,
                dashArray: type === "road" ? "4 3" : undefined,
              }),
              pointToLayer: (_f, latlng) =>
                L.circleMarker(latlng, { radius: 5, color: "#78350F", fillColor: "#FCD34D", fillOpacity: 0.8, weight: 2 }),
            });
            if (name) l.bindTooltip(type === "road" ? `🛤 ${name}` : `🏗 ${name}`, { permanent: false, direction: "top", className: "bg-white/90 backdrop-blur-sm border-0 text-slate-700 text-xs font-medium px-2 py-1 shadow-sm rounded-md" });
            l.addTo(bGroup);
          } else if (["landmark", "entry_point", "watchtower", "office"].includes(type)) {
            if (geomType === "Point") {
              const coords: [number, number] = [
                feature.geometry.coordinates[1],
                feature.geometry.coordinates[0],
              ];
              
              const typeColors: Record<string, string> = {
                entry_point: "#f59e0b", // amber
                watchtower: "#8b5cf6", // violet
                office: "#3b82f6",     // blue
                landmark: "#f43f5e",   // rose
              };
              const pinColor = typeColors[type] || "#64748b";
              
              const svg = `<svg width="24" height="32" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C5.373 0 0 5.373 0 12C0 21 12 32 12 32C12 32 24 21 24 12C24 5.373 18.627 0 12 0Z" fill="${pinColor}" stroke="#FFFFFF" stroke-width="1.5" style="filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.3));"/>
                <circle cx="12" cy="11" r="5" fill="#FFFFFF"/>
              </svg>`;

              const icon = L.divIcon({
                html: svg,
                className: "custom-svg-pin",
                iconSize: [24, 32],
                iconAnchor: [12, 32],
                popupAnchor: [0, -32]
              });
              const marker = L.marker(coords, { icon });
              if (name) marker.bindTooltip(name, { permanent: false, direction: "top", offset: [0, -20], className: "bg-white/90 backdrop-blur-sm border-0 text-slate-800 text-xs font-bold px-2 py-1 shadow-md rounded-md" });
              marker.on("click", () => onFeatureClick?.(feature.properties || {}));
              marker.addTo(lGroup);
            }
          }
        });

        clearAndSet("water", wGroup);
        clearAndSet("buildings", bGroup);
        clearAndSet("locations", lGroup);
      })
      .catch((e) => console.warn(`[GISPortal] Layer file for ${regionId} not found:`, e));
  }

  return <div ref={container} className="h-full w-full" />;
}
