"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers, Trees, Droplets, Building2, MapPin,
  Shield, ChevronRight, Info, BarChart3, AlertTriangle,
  Globe2, Navigation2
} from "lucide-react";
import { REGIONS } from "@/lib/regions";
import { ZONE_STYLE } from "@/lib/gisLayers";
import { useAlerts, useAlertSummary, type Alert } from "@/hooks/useAlerts";

const GISPortalMap = dynamic(
  () => import("@/components/gis-portal/GISPortalMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full animate-pulse bg-slate-800 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading GIS Map…</div>
      </div>
    ),
  }
);

type OverlayKey = "boundaries" | "geofence" | "water" | "buildings" | "locations" | "alerts";

const LAYER_CONFIG: Array<{ key: OverlayKey; label: string; icon: React.ElementType; color: string }> = [
  { key: "boundaries", label: "Reserve Boundaries", icon: Globe2, color: "#16A34A" },
  { key: "geofence", label: "Geo-Fence Zones", icon: Shield, color: "#DC2626" },
  { key: "water", label: "Water Bodies", icon: Droplets, color: "#2563EB" },
  { key: "buildings", label: "Infrastructure", icon: Building2, color: "#D97706" },
  { key: "locations", label: "Landmarks & Posts", icon: MapPin, color: "#7C3AED" },
  { key: "alerts", label: "Active Fire Alerts", icon: AlertTriangle, color: "#DC2626" },
];

const ZONE_LEGEND = [
  { type: "core_zone" as const, abbr: "C" },
  { type: "buffer_zone" as const, abbr: "B" },
  { type: "eco_sensitive_zone" as const, abbr: "E" },
];

// Per-region administrative metadata
const REGION_ADMIN: Record<string, {
  division: string;
  ranges: string[];
  beats: string;
  compartments: string;
  area_ha: string;
}> = {
  corbett: {
    division: "Corbett Tiger Reserve",
    ranges: ["Dhikala", "Bijrani", "Jhirna", "Dhela", "Sonanadi"],
    beats: "47 beats across 5 ranges",
    compartments: "122 compartments",
    area_ha: "1,31,800 ha",
  },
  similipal: {
    division: "Similipal Tiger Reserve, Baripada",
    ranges: ["Baripada", "Khadgarh", "Pithabata", "Nawana", "Jashipur"],
    beats: "64 beats across 5 ranges",
    compartments: "241 compartments",
    area_ha: "2,75,000 ha",
  },
  jyotikuchi: {
    division: "Kamrup Forest Division",
    ranges: ["Jyotikuchi Range"],
    beats: "8 beats",
    compartments: "22 compartments",
    area_ha: "8,500 ha",
  },
  laisong: {
    division: "Dima Hasao Forest Division",
    ranges: ["Haflong Range", "Laisong Range"],
    beats: "18 beats across 2 ranges",
    compartments: "56 compartments",
    area_ha: "45,000 ha",
  },
};

export default function GISPortalPage() {
  const [activeRegion, setActiveRegion] = useState("corbett");
  const [visibleLayers, setVisibleLayers] = useState<Record<OverlayKey, boolean>>({
    boundaries: true,
    geofence: true,
    water: true,
    buildings: true,
    locations: true,
    alerts: true,
  });
  const [selectedFeature, setSelectedFeature] = useState<Record<string, string> | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const { data: alerts = [] } = useAlerts();
  const { data: alertSummary = [] } = useAlertSummary();

  const region = REGIONS.find((r) => r.id === activeRegion)!;
  const admin = REGION_ADMIN[activeRegion];

  const toggleLayer = useCallback((key: OverlayKey) => {
    setVisibleLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleFeatureClick = useCallback((props: Record<string, string>) => {
    setSelectedFeature(props);
  }, []);

  const handleAlertClick = useCallback((alert: Alert) => {
    setSelectedFeature({
      name: alert.zone_name,
      layer_type: "Fire alert",
      description: `${alert.date} · ${alert.confidence.toUpperCase()} confidence`,
      protection_level: `FRP ${alert.frp.toFixed(1)} MW`,
      state: alert.state,
    });
  }, []);

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-slate-950">
      {/* ─── LEFT SIDEBAR ─── */}
      <aside className="w-[340px] shrink-0 overflow-y-auto bg-[#0F172A] border-r border-slate-800 flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-800">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-2 mb-1">
              <Globe2 className="h-5 w-5 text-emerald-400" />
              <h1 className="text-[17px] font-bold text-white tracking-tight">GIS Portal</h1>
            </div>
            <p className="text-[12px] text-slate-400 leading-relaxed">
              Forest management decision support — spatial database, geo-fencing & administrative layers
            </p>
          </motion.div>
        </div>

        {/* Region Selector */}
        <div className="p-4 border-b border-slate-800">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Monitored Regions</p>
          <div className="space-y-1.5">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRegion(r.id)}
                className={`w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ${
                  activeRegion === r.id
                    ? "bg-emerald-600/20 ring-1 ring-emerald-500/40 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                <Trees className={`h-4 w-4 shrink-0 mt-0.5 ${activeRegion === r.id ? "text-emerald-400" : "text-slate-600"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold leading-tight">{r.name}</p>
                  <p className="text-[11px] mt-0.5 text-slate-500">{r.state} · {r.area_sq_km} km²</p>
                </div>
                {activeRegion === r.id && (
                  <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0 mt-1.5" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Layer Controls */}
        <div className="p-4 border-b border-slate-800">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <Layers className="h-3 w-3" /> Map Layers
          </p>
          <div className="space-y-1.5">
            {LAYER_CONFIG.map(({ key, label, icon: Icon, color }) => (
              <button
                key={key}
                onClick={() => toggleLayer(key)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-all ${
                  visibleLayers[key]
                    ? "bg-slate-800/80 text-slate-200"
                    : "text-slate-500 hover:bg-slate-800/40"
                }`}
              >
                <div
                  className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-all`}
                  style={{
                    background: visibleLayers[key] ? color : "transparent",
                    borderColor: visibleLayers[key] ? color : "#475569",
                  }}
                >
                  {visibleLayers[key] && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="2,6 5,9 10,3" />
                    </svg>
                  )}
                </div>
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                <span className="text-[12px] font-medium">{label}</span>
              </button>
            ))}
          </div>

          {/* Zone Legend */}
          <div className="mt-4 pt-4 border-t border-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Zone Types</p>
            <div className="space-y-1.5">
              {ZONE_LEGEND.map(({ type }) => {
                const style = ZONE_STYLE[type];
                return (
                  <div key={type} className="flex items-center gap-2">
                    <div
                      className="h-3 w-6 rounded-sm"
                      style={{ background: style.fill, opacity: 0.8, border: `2px solid ${style.color}` }}
                    />
                    <span className="text-[11px] text-slate-400">{style.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Administrative Info */}
        {admin && (
          <div className="p-4 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
              <BarChart3 className="h-3 w-3" /> Administrative Data
            </p>
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-800/60 px-3 py-2.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Division</p>
                <p className="text-[12px] text-slate-200 font-medium">{admin.division}</p>
              </div>
              <div className="rounded-lg bg-slate-800/60 px-3 py-2.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Ranges</p>
                <div className="flex flex-wrap gap-1">
                  {admin.ranges.map((r) => (
                    <span key={r} className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] text-emerald-300 font-medium">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-800/60 px-3 py-2.5">
                  <p className="text-[10px] text-slate-500 mb-0.5">Beats</p>
                  <p className="text-[11px] text-slate-300">{admin.beats}</p>
                </div>
                <div className="rounded-lg bg-slate-800/60 px-3 py-2.5">
                  <p className="text-[10px] text-slate-500 mb-0.5">Total Area</p>
                  <p className="text-[11px] text-slate-300">{admin.area_ha}</p>
                </div>
              </div>
              <div className="rounded-lg bg-slate-800/60 px-3 py-2.5">
                <p className="text-[10px] text-slate-500 mb-0.5">Compartments</p>
                <p className="text-[12px] text-slate-300">{admin.compartments}</p>
              </div>
            </div>

            {/* Spatial Query Info */}
            <div className="mt-4 rounded-lg bg-blue-950/60 ring-1 ring-blue-800/50 px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <Navigation2 className="h-3 w-3 text-blue-400" />
                <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Spatial Query</p>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Point-in-polygon checks classify any detection coordinate against
                Core, Buffer, and Eco-Sensitive zones in real time to prioritize
                field verification alerts.
              </p>
            </div>
          </div>
        )}
      </aside>

      {/* ─── MAIN MAP ─── */}
      <main className="flex-1 relative overflow-hidden">
        <GISPortalMap
          activeRegion={activeRegion}
          visibleLayers={visibleLayers}
          onFeatureClick={handleFeatureClick}
          alerts={alerts}
          onAlertClick={handleAlertClick}
        />

        {/* Active Region Badge */}
        <motion.div
          key={activeRegion}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-4 left-4 z-[500] flex items-center gap-3 rounded-xl bg-slate-900/90 backdrop-blur-md px-4 py-2.5 shadow-xl ring-1 ring-white/10"
        >
          <Trees className="h-4 w-4 text-emerald-400" />
          <div>
            <p className="text-[13px] font-bold text-white">{region?.name}</p>
            <p className="text-[11px] text-slate-400">{region?.state} · {region?.forest_type}</p>
          </div>
        </motion.div>

        {/* Feature Info Popup */}
        <AnimatePresence>
          {selectedFeature && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[500] rounded-2xl bg-slate-900/95 backdrop-blur-md px-5 py-4 shadow-2xl ring-1 ring-white/10 max-w-[480px] w-full mx-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Info className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                    <p className="text-[11px] font-bold uppercase tracking-widest text-blue-400">
                      {selectedFeature.zone_type
                        ? ZONE_STYLE[selectedFeature.zone_type as keyof typeof ZONE_STYLE]?.label || "Zone"
                        : selectedFeature.layer_type || "Feature"}
                    </p>
                  </div>
                  <p className="text-[14px] font-bold text-white truncate">
                    {selectedFeature.name || "Unnamed Feature"}
                  </p>
                  {selectedFeature.description && (
                    <p className="mt-1 text-[12px] text-slate-400 line-clamp-2">{selectedFeature.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedFeature.protection_level && (
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                        Protection: {selectedFeature.protection_level}
                      </span>
                    )}
                    {selectedFeature.management_unit && (
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                        {selectedFeature.management_unit}
                      </span>
                    )}
                    {selectedFeature.area_sqkm && (
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                        {selectedFeature.area_sqkm} km²
                      </span>
                    )}
                    {selectedFeature.state && (
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                        {selectedFeature.state}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedFeature(null)}
                  className="text-slate-500 hover:text-slate-300 transition-colors text-xl leading-none shrink-0"
                >
                  ×
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute bottom-5 left-4 z-[500] rounded-xl bg-slate-900/90 px-4 py-3 text-white shadow-xl ring-1 ring-white/10">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Geo-Fence Monitoring</p>
          <p className="mt-1 text-[13px] font-semibold">{alerts.length} active detection{alerts.length === 1 ? "" : "s"}</p>
          <p className="text-[11px] text-slate-400">{alertSummary.filter((zone) => zone.status !== "safe").length} monitored zone{alertSummary.filter((zone) => zone.status !== "safe").length === 1 ? "" : "s"} under watch</p>
        </div>

        {/* Right panel toggle */}
        <button
          onClick={() => setRightPanelOpen((p) => !p)}
          className="absolute top-4 right-4 z-[500] rounded-lg bg-slate-900/90 backdrop-blur-md p-2 shadow-lg ring-1 ring-white/10 text-slate-400 hover:text-white transition-colors"
          title="Toggle info panel"
        >
          <ChevronRight
            className={`h-4 w-4 transition-transform duration-300 ${rightPanelOpen ? "rotate-180" : ""}`}
          />
        </button>

        {/* Right info panel */}
        <AnimatePresence>
          {rightPanelOpen && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="absolute top-14 right-4 z-[500] w-[260px] space-y-3"
            >
              {/* Region overview */}
              <div className="rounded-xl bg-slate-900/90 backdrop-blur-md p-4 ring-1 ring-white/10 shadow-xl">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Region Overview</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[11px] text-slate-400">Forest Type</span>
                    <span className="text-[11px] text-slate-200 font-medium text-right max-w-[130px] leading-tight">
                      {region?.forest_type}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[11px] text-slate-400">Fire Season</span>
                    <span className="text-[11px] text-slate-200 font-medium">{region?.fire_season}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[11px] text-slate-400">Elevation</span>
                    <span className="text-[11px] text-slate-200 font-medium">{region?.elevation}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[11px] text-slate-400">Area</span>
                    <span className="text-[11px] text-slate-200 font-medium">{region?.area_sq_km} km²</span>
                  </div>
                </div>
              </div>

              {/* Geo-fence zones summary */}
              <div className="rounded-xl bg-slate-900/90 backdrop-blur-md p-4 ring-1 ring-white/10 shadow-xl">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-amber-400" /> Zone Priority
                </p>
                <div className="space-y-1.5">
                  {ZONE_LEGEND.map(({ type }) => {
                    const style = ZONE_STYLE[type];
                    return (
                      <div key={type} className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-5 rounded-sm shrink-0"
                          style={{ background: style.fill, border: `1.5px solid ${style.color}` }}
                        />
                        <span className="text-[11px] text-slate-300">{style.label}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-[10px] text-slate-500 leading-relaxed">
                  Alerts inside Core Zones are classified critical. Buffer alerts are high priority. Eco-Sensitive zone alerts are elevated.
                </p>
              </div>

              {/* Coordinates */}
              <div className="rounded-xl bg-slate-900/90 backdrop-blur-md p-4 ring-1 ring-white/10 shadow-xl">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Coordinates</p>
                <p className="text-[11px] text-slate-300 font-mono">
                  Centre: {region?.center.lat}°N, {region?.center.lon}°E
                </p>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  Bounds: {region?.bounds.lat_min}–{region?.bounds.lat_max}°N
                </p>
                <p className="text-[11px] text-slate-500 font-mono">
                  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{region?.bounds.lon_min}–{region?.bounds.lon_max}°E
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
