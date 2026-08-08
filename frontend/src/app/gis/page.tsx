"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/constants";
import { motion, AnimatePresence } from "framer-motion";
import { X, Layers, MapPin, Trees, Mountain, Calendar, ChevronRight } from "lucide-react";

const GISZoneMap = dynamic(() => import("@/components/map/GISZoneMap"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center bg-slate-100"><div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-500 border-t-transparent" /></div>,
});

interface ZoneFeature {
  id: number; name: string; type: string; state?: string; area_ha?: number;
  geojson: string; color: string; metadata: Record<string, unknown>;
}

interface ZoneDetail {
  id: number; name: string; type: string; state?: string; district?: string;
  area_ha?: number; color: string; metadata: Record<string, unknown>;
  children: Array<{ id: number; name: string; type: string }>;
}

const TYPE_LABELS: Record<string, string> = {
  reserve: "Reserve", buffer_zone: "Buffer Zone", core_forest: "Core Forest",
  eco_sensitive: "Eco-Sensitive Area", beat_boundary: "Beat Boundary", compartment: "Compartment",
};

const TYPE_COLORS: Record<string, string> = {
  reserve: "#2563EB", buffer_zone: "#F59E0B", core_forest: "#16A34A",
  eco_sensitive: "#7C3AED", beat_boundary: "#64748B", compartment: "#0EA5E9",
};

export default function GISPortalPage() {
  const [zones, setZones] = useState<ZoneFeature[]>([]);
  const [selected, setSelected] = useState<ZoneFeature | null>(null);
  const [detail, setDetail] = useState<ZoneDetail | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [dLoading, setDLoading] = useState(false);

  const toggleType = (t: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  const onZoneClick = useCallback(async (z: ZoneFeature) => {
    setSelected(z);
    setDLoading(true);
    setDetail(null);
    try {
      const r = await fetch(api(`/api/v1/gis/zones/${z.id}`));
      if (r.ok) setDetail(await r.json());
    } catch {} finally { setDLoading(false); }
  }, []);

  const close = () => { setSelected(null); setDetail(null); };

  const typeCounts: Record<string, number> = {};
  zones.forEach((z) => { typeCounts[z.type] = (typeCounts[z.type] || 0) + 1; });
  const typesSorted = Object.entries(typeCounts).sort(([, a], [, b]) => b - a);

  return (
    <div className="relative h-[calc(100vh-64px)] w-full overflow-hidden">
      <GISZoneMap onZonesLoaded={setZones} onZoneClick={onZoneClick} hiddenTypes={hiddenTypes} />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-white/95 to-white/80 backdrop-blur-xl border-b border-slate-200/60 px-6 py-3">
        <div className="flex items-center justify-between max-w-full">
          <div>
            <h1 className="text-[18px] font-bold text-slate-900 tracking-tight">GIS Decision Support Platform</h1>
            <p className="text-[12px] text-slate-500">{zones.length} zones · 6 layer types · PostGIS spatial database</p>
          </div>
          <div className="flex items-center gap-4">
            {[{ label: "Zones", value: zones.length }, { label: "Layers", value: Object.keys(typeCounts).length }, { label: "States", value: new Set(zones.map((z) => z.state).filter(Boolean)).size }].map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-[20px] font-black tabular-nums text-slate-800 leading-tight">{s.value}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Layer toggle panel */}
      <div className="absolute top-20 right-4 z-10 rounded-2xl bg-white/95 backdrop-blur-xl px-4 py-3 shadow-xl shadow-slate-200/50 ring-1 ring-slate-200/70 w-52">
        <div className="flex items-center gap-2 mb-3">
          <Layers className="h-4 w-4 text-blue-600" />
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Layer Manager</p>
        </div>
        <div className="space-y-1">
          {typesSorted.map(([t, count]) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-left transition-all duration-150 ${
                !hiddenTypes.has(t) ? "bg-slate-50" : "opacity-40"
              }`}
            >
              <span className="h-3 w-3 rounded ring-1 ring-offset-1 ring-white shrink-0" style={{ background: TYPE_COLORS[t] || "#94A3B8" }} />
              <span className="text-[12px] font-medium text-slate-700 flex-1 truncate">{TYPE_LABELS[t] || t}</span>
              <span className="text-[10px] font-bold tabular-nums text-slate-400">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 rounded-xl bg-white/95 backdrop-blur-xl px-4 py-3 shadow-lg ring-1 ring-slate-200/70">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Zone Types</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {typesSorted.map(([t]) => (
            <div key={t} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full ring-1 ring-offset-1 ring-white" style={{ background: TYPE_COLORS[t] || "#94A3B8" }} />
              <span className="text-[12px] text-slate-600">{TYPE_LABELS[t] || t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute top-0 right-0 z-20 h-full w-[400px] overflow-y-auto bg-white shadow-2xl border-l border-slate-200/80"
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur-xl z-10 border-b border-slate-100 px-5 py-4 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <h2 className="text-[16px] font-bold text-slate-900 truncate">{selected.name}</h2>
                <span className="inline-flex items-center gap-1.5 mt-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                  style={{ background: selected.color + "20", color: selected.color }}>
                  {TYPE_LABELS[selected.type] || selected.type}
                </span>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            {dLoading && <div className="flex justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /></div>}

            {detail && (
              <div className="p-5 space-y-4">
                {/* Meta grid */}
                <div className="grid grid-cols-2 gap-3">
                  {detail.state && (
                    <div className="rounded-xl bg-slate-50 p-3 flex items-center gap-2.5">
                      <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                      <div><p className="text-[10px] uppercase tracking-wider text-slate-400">State</p><p className="text-[13px] font-semibold text-slate-700">{detail.state}</p></div>
                    </div>
                  )}
                  {detail.district && (
                    <div className="rounded-xl bg-slate-50 p-3 flex items-center gap-2.5">
                      <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                      <div><p className="text-[10px] uppercase tracking-wider text-slate-400">District</p><p className="text-[13px] font-semibold text-slate-700">{detail.district}</p></div>
                    </div>
                  )}
                  {detail.area_ha && (
                    <div className="rounded-xl bg-slate-50 p-3 flex items-center gap-2.5">
                      <Trees className="h-4 w-4 text-slate-400 shrink-0" />
                      <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Area</p><p className="text-[13px] font-semibold text-slate-700">{detail.area_ha >= 1000 ? `${(detail.area_ha / 1000).toFixed(0)}k` : detail.area_ha.toFixed(0)} ha</p></div>
                    </div>
                  )}
                  {detail.metadata?.elevation ? (
                    <div className="rounded-xl bg-slate-50 p-3 flex items-center gap-2.5">
                      <Mountain className="h-4 w-4 text-slate-400 shrink-0" />
                      <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Elevation</p><p className="text-[13px] font-semibold text-slate-700">{String(detail.metadata.elevation)}</p></div>
                    </div>
                  ) : null}
                  {detail.metadata?.forest_type ? (
                    <div className="rounded-xl bg-slate-50 p-3 flex items-center gap-2.5 col-span-2">
                      <Trees className="h-4 w-4 text-slate-400 shrink-0" />
                      <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Forest Type</p><p className="text-[13px] font-semibold text-slate-700">{String(detail.metadata.forest_type)}</p></div>
                    </div>
                  ) : null}
                  {detail.metadata?.fire_season ? (
                    <div className="rounded-xl bg-slate-50 p-3 flex items-center gap-2.5">
                      <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                      <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Fire Season</p><p className="text-[13px] font-semibold text-slate-700">{String(detail.metadata.fire_season)}</p></div>
                    </div>
                  ) : null}
                </div>

                {/* Children */}
                {detail.children.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Sub-zones ({detail.children.length})</p>
                    <div className="space-y-1">
                      {detail.children.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-[13px] font-medium text-slate-700 flex-1">{c.name}</span>
                          <span className="text-[10px] text-slate-400">{TYPE_LABELS[c.type] || c.type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
