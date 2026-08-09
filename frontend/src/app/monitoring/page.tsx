"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/constants";
import { motion, AnimatePresence } from "framer-motion";
import {
  Satellite, Activity, Calendar, TrendingDown, TrendingUp, Minus,
  AlertTriangle, CheckCircle2, Database, Zap, Clock, Shield,
  Layers, BarChart3, MapPin, Target, Play, RefreshCw,
} from "lucide-react";

const MonitorMap = dynamic(() => import("@/components/map/DeforestationMap"), { ssr: false });

interface ZoneItem { id: number; name: string; type: string; }
interface ScanResult {
  zone_id: number; zone_name: string; before_year: number; after_year: number;
  before_ndvi: number; after_ndvi: number; ndvi_change: number; change_pct: number;
  affected_area_ha: number; severity: string; confidence: number;
  change_type: string; detected_at: string; data_source: string;
  change_polygons: Array<{ type: string; coordinates: number[][][] }>;
  summary: string;
}
interface ProviderInfo { name: string; available: boolean; }
interface ScanHistory { id: number; zone_name: string; before_year: number; after_year: number; severity: string; ndvi_change: number; created_at: string; summary: string; }

const SEV_COLORS: Record<string, string> = {
  critical: "#DC2626", significant: "#F97316", moderate: "#F59E0B", minor: "#94A3B8", none: "#22C55E",
};
const SEV_BG: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  significant: "bg-orange-50 text-orange-700 border-orange-200",
  moderate: "bg-amber-50 text-amber-700 border-amber-200",
  minor: "bg-slate-50 text-slate-600 border-slate-200",
  none: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export default function MonitoringPage() {
  const [zones, setZones] = useState<ZoneItem[]>([]);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanHistory[]>([]);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [beforeYear, setBeforeYear] = useState(2005);
  const [afterYear, setAfterYear] = useState(2025);
  const [tab, setTab] = useState<"scan" | "history">("scan");

  useEffect(() => {
    fetch(api("/api/v1/gis/map-data")).then((r) => r.json()).then((z: ZoneItem[]) => { setZones(z.filter((x: ZoneItem) => x.type === "reserve")); if (z.length > 0) setZoneId(z[0].id); });
    fetch(api("/api/v1/monitoring/provider")).then((r) => r.json()).then(setProvider);
    fetch(api("/api/v1/monitoring/history?limit=10")).then((r) => r.json()).then(setHistory);
  }, []);

  const runScan = useCallback(async () => {
    if (!zoneId) return;
    setScanning(true); setResult(null);
    try {
      const r = await fetch(api("/api/v1/monitoring/scan"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zone_id: zoneId, before_year: beforeYear, after_year: afterYear }) });
      if (r.ok) setResult(await r.json());
    } catch {} finally { setScanning(false); }
  }, [zoneId, beforeYear, afterYear]);

  const sev = result?.severity || "none";
  const scan = result;

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[#F8FAFC]">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2"><Satellite className="h-5 w-5 text-blue-600" /><h1 className="text-[20px] font-bold text-slate-900 tracking-tight">Satellite Change Detection</h1></div>
            <p className="text-[12px] text-slate-500 mt-0.5">AI-assisted vegetation monitoring · NDVI analysis · {provider?.name || "Loading..."}</p>
          </div>
          <div className="flex items-center gap-3">
            {provider && (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${provider.available ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                {provider.available ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {provider.name}
              </span>
            )}
            <button onClick={runScan} disabled={scanning || !zoneId} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[13px] font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md shadow-blue-200">
              <Play className="h-4 w-4" />{scanning ? "Scanning..." : "Run Detection"}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="grid grid-cols-3 gap-6">
          {/* Sidebar */}
          <div className="space-y-4">
            {/* Zone selector */}
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/60">
              <div className="flex items-center gap-2 mb-3"><MapPin className="h-4 w-4 text-blue-600" /><span className="text-[12px] font-bold uppercase tracking-wider text-slate-400">Target Zone</span></div>
              <select value={zoneId || ""} onChange={(e) => setZoneId(Number(e.target.value))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] font-semibold text-slate-700">
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>

            {/* Year range */}
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/60">
              <div className="flex items-center gap-2 mb-3"><Calendar className="h-4 w-4 text-blue-600" /><span className="text-[12px] font-bold uppercase tracking-wider text-slate-400">Time Range</span></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-slate-400">Baseline</label><select value={beforeYear} onChange={(e) => setBeforeYear(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[13px] text-slate-700">{Array.from({ length: 21 }, (_, i) => 2005 + i).map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
                <div><label className="text-[10px] font-bold uppercase text-slate-400">Compare</label><select value={afterYear} onChange={(e) => setAfterYear(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[13px] text-slate-700">{Array.from({ length: 21 }, (_, i) => 2005 + i).filter((y) => y > beforeYear).map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
              </div>
            </div>

            {/* Provider info */}
            <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-blue-50 p-4 ring-1 ring-slate-200/60">
              <div className="flex items-center gap-2 mb-2"><Database className="h-4 w-4 text-blue-600" /><span className="text-[12px] font-bold text-slate-700">Data Source</span></div>
              <p className="text-[12px] text-slate-500 leading-relaxed">
                {provider?.available
                  ? `Live satellite data from ${provider.name}. NDVI computed from Sentinel-2 MSI bands.`
                  : `${provider?.name || "Demo"} vegetation data. Based on 21 years of modeled NDVI values with realistic decline patterns.`}
              </p>
            </div>
          </div>

          {/* Main content */}
          <div className="col-span-2 space-y-6">
            {/* Tabs */}
            <div className="flex gap-1 border-b border-slate-200">
              {[{ key: "scan" as const, label: "Change Detection", icon: Activity }, { key: "history" as const, label: "Scan History", icon: Clock }].map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-2 px-5 py-3 text-[13px] font-medium border-b-2 transition-colors ${tab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                  <t.icon className="h-3.5 w-3.5" />{t.label}
                </button>
              ))}
              {history.length > 0 && <span className="ml-auto self-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600">{history.length} scans</span>}
            </div>

            {/* Loading */}
            {scanning && (
              <div className="flex flex-col items-center justify-center py-16 rounded-2xl bg-white ring-1 ring-slate-200/60">
                <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-600 border-t-transparent mb-4" />
                <p className="text-[14px] font-semibold text-slate-700">Running satellite analysis...</p>
                <p className="text-[12px] text-slate-400 mt-1">Comparing {beforeYear} baseline with {afterYear} imagery</p>
              </div>
            )}

            {/* Results */}
            {!scanning && scan && tab === "scan" && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                {/* Severity banner */}
                <div className="rounded-2xl p-5 ring-2" style={{ background: SEV_COLORS[sev] + "10", borderColor: SEV_COLORS[sev] }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="rounded-full px-3 py-1 text-[12px] font-bold text-white" style={{ background: SEV_COLORS[sev] }}>{scan.severity.toUpperCase()}</span>
                        <span className="text-[13px] font-semibold" style={{ color: SEV_COLORS[sev] }}>{scan.change_type === "declining" ? <TrendingDown className="h-4 w-4 inline" /> : scan.change_type === "improving" ? <TrendingUp className="h-4 w-4 inline" /> : <Minus className="h-4 w-4 inline" />} {scan.change_type}</span>
                      </div>
                      <h2 className="text-[17px] font-bold text-slate-900">{scan.zone_name}</h2>
                      <p className="text-[13px] text-slate-500 mt-0.5">{scan.summary}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-slate-400">Confidence</p>
                      <p className="text-[28px] font-black tabular-nums" style={{ color: SEV_COLORS[sev] }}>{(scan.confidence * 100).toFixed(0)}%</p>
                    </div>
                  </div>
                </div>

                {/* KPI cards */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: `NDVI ${scan.before_year}`, value: scan.before_ndvi.toFixed(4), cls: "text-slate-700" },
                    { label: `NDVI ${scan.after_year}`, value: scan.after_ndvi.toFixed(4), cls: "text-slate-700" },
                    { label: "NDVI Change", value: `${scan.ndvi_change > 0 ? "+" : ""}${(scan.ndvi_change * 100).toFixed(1)}%`, cls: scan.ndvi_change < 0 ? "text-red-600" : "text-emerald-600" },
                    { label: "Affected Area", value: scan.affected_area_ha > 0 ? `${scan.affected_area_ha.toFixed(1)} ha` : "—", cls: "text-orange-600" },
                  ].map((k) => (
                    <div key={k.label} className="rounded-2xl bg-white p-4 text-center ring-1 ring-slate-200/60">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{k.label}</p>
                      <p className={`text-[20px] font-black tabular-nums ${k.cls}`}>{k.value}</p>
                    </div>
                  ))}
                </div>

                {/* Change polygons */}
                {scan.change_polygons.length > 0 && (
                  <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/60">
                    <div className="flex items-center gap-2 mb-4"><Target className="h-4 w-4 text-red-500" /><span className="text-[13px] font-bold text-slate-700">Detected Change Areas</span><span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">{scan.change_polygons.length} polygons</span></div>
                    <div className="grid grid-cols-2 gap-2">
                      {scan.change_polygons.map((p, i) => (
                        <div key={i} className="rounded-xl bg-red-50 p-3 ring-1 ring-red-100">
                          <p className="text-[11px] font-bold text-red-700">Change Zone {i + 1}</p>
                          <p className="text-[10px] text-red-500 mt-0.5">{p.coordinates[0].length} vertices · {p.type}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Data source footer */}
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200/60">
                  <Database className="h-4 w-4 text-slate-400" />
                  <div className="flex-1">
                    <p className="text-[11px] font-medium text-slate-600">Data Source: {scan.data_source === "demo" ? "Modeled Vegetation History (21-year DB)" : scan.data_source}</p>
                    <p className="text-[10px] text-slate-400">Analysis run at {new Date(scan.detected_at).toLocaleString()}</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">{scan.data_source === "demo" ? "DEMO DATA" : "SATELLITE"}</span>
                </div>
              </motion.div>
            )}

            {/* History tab */}
            {tab === "history" && (
              <div className="space-y-3">
                {history.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 rounded-2xl bg-white ring-1 ring-slate-200/60 text-slate-400">
                    <Shield className="h-8 w-8 mb-3" />
                    <p className="text-[14px] font-medium">No scans yet</p>
                    <p className="text-[12px] mt-1">Run a change detection scan to see history</p>
                  </div>
                )}
                {history.map((h) => (
                  <div key={h.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/60 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white" style={{ background: SEV_COLORS[h.severity] || "#94A3B8" }}>{h.severity.toUpperCase()}</span>
                        <span className="text-[13px] font-bold text-slate-700">{h.zone_name}</span>
                      </div>
                      <span className="text-[11px] text-slate-400">{new Date(h.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-[12px] text-slate-500">{h.before_year} → {h.after_year} · NDVI change: {(h.ndvi_change * 100).toFixed(1)}%</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
