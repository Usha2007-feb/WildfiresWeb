"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAppStore } from "@/stores/appStore";
import { INDIA_CENTER } from "@/lib/constants";
import { api } from "@/lib/constants";
import ActiveFireLayer from "@/components/map/ActiveFireLayer";
import RegionOverlay from "@/components/map/RegionOverlay";
import AlertMarkerLayer from "@/components/map/AlertMarkerLayer";

const IMG_URL = api("/api/v1/heatmap-image.png");
const IMG_BOUNDS: L.LatLngBoundsExpression = [[3.0, 64.0], [39.0, 100.0]];

function preloadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);

  const heatmapVisible = useAppStore((s) => s.heatmapVisible);
  const firmsVisible = useAppStore((s) => s.firmsVisible);
  const forestRange = useAppStore((s) => s.activeReserve);
  const getForestBounds = useAppStore((s) => s.getReserveBounds);
  const selectedPoint = useAppStore((s) => s.selectedPoint);
  const setViewState = useAppStore((s) => s.setViewState);
  const setSelectedPoint = useAppStore((s) => s.setSelectedPoint);
  const flyTo = useAppStore((s) => s.flyTo);
  const setFlyTo = useAppStore((s) => s.setFlyTo);

  useEffect(() => {
    if (!container.current || mapRef.current) return;

    const map = L.map(container.current, {
      center: [INDIA_CENTER[1], INDIA_CENTER[0]],
      zoom: 5.8,
      minZoom: 5, maxZoom: 18,
      zoomControl: true, attributionControl: false,
      maxBounds: L.latLngBounds([2.0, 62.0], [41.0, 102.0]),
      maxBoundsViscosity: 1.0,
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Tiles &copy; Esri", maxZoom: 19, maxNativeZoom: 16 }
    ).addTo(map);

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      { attribution: "", maxZoom: 19, maxNativeZoom: 16 }
    ).addTo(map);

    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);

    map.on("moveend", () => {
      const c = map.getCenter();
      setViewState({ latitude: c.lat, longitude: c.lng, zoom: map.getZoom() });
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (useAppStore.getState().predictionMode) {
        setSelectedPoint({ lat: e.latlng.lat, lon: e.latlng.lng });
      }
    });

    preloadImage(IMG_URL).then((ok) => {
      if (!mapRef.current) return;
      const overlay = L.imageOverlay(IMG_URL, IMG_BOUNDS, { opacity: 0.5, zIndex: 400 });
      overlay.on("load", () => {
        overlayRef.current = overlay;
        setReady(true);
      });
      overlay.on("error", () => setReady(true));
      overlay.addTo(map);
      if (!ok) setReady(true);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    setLoading(!ready);
  }, [ready]);

  useEffect(() => {
    if (overlayRef.current) overlayRef.current.setOpacity(heatmapVisible ? 0.5 : 0);
  }, [heatmapVisible]);

  useEffect(() => {
    if (!mapRef.current || forestRange === "all") return;
    const bounds = getForestBounds(forestRange);
    const lb = L.latLngBounds([bounds[0][0], bounds[0][1]], [bounds[1][0], bounds[1][1]]);
    mapRef.current.flyToBounds(lb, { padding: [60, 60], duration: 1.0, maxZoom: 14 });
  }, [forestRange, getForestBounds]);

  useEffect(() => {
    if (!mapRef.current || !flyTo) return;
    mapRef.current.flyTo([flyTo.lat, flyTo.lon], flyTo.zoom, { duration: 1.0 });
    setFlyTo(null);
  }, [flyTo, setFlyTo]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (markerRef.current) { mapRef.current.removeLayer(markerRef.current); markerRef.current = null; }
    if (!selectedPoint) return;
    markerRef.current = L.circleMarker([selectedPoint.lat, selectedPoint.lon], {
      radius: 8, color: "#F97316", fillColor: "#F97316", fillOpacity: 0.5, weight: 2.5,
    }).addTo(mapRef.current);
  }, [selectedPoint]);

  return (
    <>
      <div ref={container} className="absolute inset-0 z-0 bg-slate-100" />
      <ActiveFireLayer map={mapRef.current} visible={firmsVisible} />
      <RegionOverlay map={mapRef.current} reserve={forestRange} />
      <AlertMarkerLayer map={mapRef.current} visible={true} />
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-white/60">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white/90 px-8 py-5 shadow-xl">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-[13px] font-medium text-slate-500">Loading wildfire data...</p>
          </div>
        </div>
      )}
    </>
  );
}
