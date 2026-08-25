"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RegionConfig } from "./encroachmentData";
import type { LayerKey } from "./LayerSwitcher";

/** GeoJSON feature returned by the /analysis endpoint */
export interface ChangeFeature {
  type: "Feature";
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
  properties: { id: string; label: string; type: string; area_ha: number };
}

/** Colour each change type */
const CHANGE_COLORS: Record<string, string> = {
  forest_degradation:   "#F97316",
  deforestation:        "#DC2626",
  new_agriculture:      "#EAB308",
  new_settlement:       "#7C3AED",
  burn_disturbance:     "#7F1D1D",
  forest_loss_candidate: "#EF4444",
};

interface Props {
  region: RegionConfig;
  indexTileUrl: string | null;
  showEncroachment: boolean;
  changeFeatures: ChangeFeature[];
  activeLayer: LayerKey;
  beforeYear: number;
  afterYear: number;
}

export default function EncroachmentMap({
  region,
  indexTileUrl,
  showEncroachment,
  changeFeatures,
  activeLayer,
  beforeYear,
  afterYear,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<L.Map | null>(null);
  const baseLayerRef  = useRef<L.TileLayer | null>(null);
  const indexLayerRef = useRef<L.TileLayer | null>(null);
  const boundaryRef   = useRef<L.Layer | null>(null);
  const changeRef     = useRef<L.LayerGroup | null>(null);

  // ── Initialise map once ─────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: region.center,
      zoom:   region.zoom,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
    });

    // High-resolution true-colour satellite basemap. Analysis index tiles and
    // detected change polygons are rendered above this photographic imagery.
    baseLayerRef.current = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      }
    ).addTo(map);

    // Labels pane (above index overlay)
    const labelsPane = map.createPane("labelsPane");
    labelsPane.style.zIndex = "650";
    labelsPane.style.pointerEvents = "none";
    L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { opacity: 0.8, pane: "labelsPane", maxZoom: 19 }
    ).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({ position: "bottomleft" }).addTo(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fly to region ───────────────────────────────────────────────────────
  useEffect(() => {
    mapRef.current?.setView(region.center, region.zoom, { animate: true, duration: 0.8 });
  }, [region]);

  // ── Boundary outline ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    boundaryRef.current?.removeFrom(map);

    fetch("/forestReserves.geojson")
      .then((r) => r.json())
      .then((data) => {
        const filtered = (data.features as any[]).filter(
          (f: any) => f?.properties?.id === region.id
        );
        if (filtered.length > 0) {
          const layer = L.geoJSON(filtered[0], {
            style: {
              color: "#22C55E",
              weight: 2.5,
              fillColor: "#22C55E",
              fillOpacity: 0.04,
              dashArray: "8 5",
            },
          });
          layer.bindTooltip(`<b>${region.name}</b>`);
          layer.addTo(map);
          boundaryRef.current = layer;
        }
      })
      .catch((err) => console.error("Failed to load boundary:", err));
  }, [region]);

  // ── Index overlay tile layer ────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove previous index layer
    if (indexLayerRef.current) {
      indexLayerRef.current.removeFrom(map);
      indexLayerRef.current = null;
    }

    if (!indexTileUrl) return;

    const pane = map.getPane("overlayPane");
    if (pane) pane.style.zIndex = "400";

    indexLayerRef.current = L.tileLayer(indexTileUrl, {
      maxZoom: 18,
      opacity: 0.62,
      crossOrigin: true,
    }).addTo(map);
  }, [indexTileUrl]);

  // ── Change polygons ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    changeRef.current?.removeFrom(map);
    if (!showEncroachment || !changeFeatures.length) return;

    const group = L.layerGroup();
    changeFeatures.forEach((feat) => {
      const color = CHANGE_COLORS[feat.properties.type] ?? "#EF4444";
      const layer = L.geoJSON(feat as GeoJSON.Feature, {
        style: {
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.45,
        },
      });
      layer.bindTooltip(
        `<div style="font-family:Inter;font-size:12px">
          <b style="color:${color}">${feat.properties.label}</b><br/>
          ${feat.properties.area_ha.toFixed(2)} ha · field verification required
        </div>`,
        { sticky: true }
      );
      layer.addTo(group);
    });
    group.addTo(map);
    changeRef.current = group;
  }, [changeFeatures, showEncroachment]);

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}
