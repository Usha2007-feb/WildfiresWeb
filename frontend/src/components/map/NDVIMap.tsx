"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/constants";

interface Props {
  year: number;
  zoneId: number | null;
  side: "left" | "right";
  onYearChange: (d: number) => void;
}

export default function NDVIMap({ year, zoneId, side, onYearChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const ndviRef = useRef<L.TileLayer | null>(null);
  const geoRef = useRef<L.GeoJSON | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (!container.current || initRef.current) return;
    initRef.current = true;

    const map = L.map(container.current, {
      center: [23.5, 80], zoom: 6,
      minZoom: 5, maxZoom: 18,
      zoomControl: true, attributionControl: false,
      scrollWheelZoom: true,
      maxBounds: L.latLngBounds([5.0, 65.0], [37.0, 100.0]),
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
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; initRef.current = false; };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (ndviRef.current) mapRef.current.removeLayer(ndviRef.current);
    const date = `${year}-07-01`;
    ndviRef.current = L.tileLayer(
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      { attribution: "NASA GIBS MODIS", opacity: 0.85, maxZoom: 12 }
    ).addTo(mapRef.current);
  }, [year]);

  useEffect(() => {
    if (!mapRef.current || !zoneId) return;
    if (geoRef.current) mapRef.current.removeLayer(geoRef.current);
    const token = localStorage.getItem("wf_token") || "";
    fetch(api(`/api/v1/admin/zones/${zoneId}/geojson`), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((geom) => {
        if (!geom || !mapRef.current) return;
        geoRef.current = L.geoJSON(geom as never, {
          style: { color: "#F97316", weight: 3, fillColor: "#F97316", fillOpacity: 0.10, dashArray: "6 3" },
        }).addTo(mapRef.current!);
        mapRef.current!.fitBounds(geoRef.current.getBounds(), { padding: [30, 30] });
      });
  }, [zoneId]);

  return (
    <div className="relative flex-1">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button onClick={() => onYearChange(-2)} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white shadow ring-1 ring-slate-200 hover:bg-slate-50">
          <ChevronLeft className="h-3.5 w-3.5 text-slate-600" />
        </button>
        <span className="rounded-lg bg-white px-3 py-1 text-[13px] font-bold tabular-nums text-slate-700 shadow ring-1 ring-slate-200">{year}</span>
        <button onClick={() => onYearChange(2)} disabled={year >= 2025} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white shadow ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-30">
          <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
        </button>
      </div>
      <div className="absolute top-3 right-3 z-10 rounded-lg bg-white/80 px-2 py-0.5 text-[10px] font-bold text-slate-400 shadow ring-1 ring-slate-200 backdrop-blur">
        {side === "left" ? "BASELINE" : "COMPARISON"}
      </div>
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
