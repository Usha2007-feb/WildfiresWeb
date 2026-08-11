"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/constants";
import { motion, AnimatePresence } from "framer-motion";
import { X, TrendingDown, TrendingUp, Minus, Trees, Square, Activity, Crosshair, Calendar, Target, FileDown } from "lucide-react";
import { useLang } from "@/components/auth/LanguageProvider";

const DeforestationMapInner = dynamic(() => import("@/components/map/DeforestationMap"), { ssr: false });

interface ZoneFeature { id: number; name: string; type: string; state?: string; geojson: string; ndvi_change: number; cover_change: number; trend: string; color: string }
interface YearlyPoint { year: number; avg_ndvi: number; avg_cover: number; avg_disturbance: number }
interface ZoneDetail {
  zone_name: string; zone_type: string; area_sq_deg?: number; intersected_zones?: number;
  intersected_names?: string[]; yearly: YearlyPoint[]; sea_body?: boolean;
  summary: { first_year: number; last_year: number; first_ndvi: number; last_ndvi: number; ndvi_change: number; cover_change_pct: number; trend: string };
}
const CHART_COLORS: Record<string, string> = { declining: "#DC2626", stable: "#F59E0B", improving: "#16A34A" };

function TrendPill({ trend, change }: { trend: string; change: number }) {
  const cfg = trend === "declining"
    ? { icon: TrendingDown, cls: "bg-red-100 text-red-700 border-red-200" }
    : trend === "improving"
      ? { icon: TrendingUp, cls: "bg-emerald-100 text-emerald-700 border-emerald-200" }
      : { icon: Minus, cls: "bg-amber-100 text-amber-700 border-amber-200" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold ${cfg.cls}`}>
      <cfg.icon className="h-3.5 w-3.5" />
      {trend} <span className="tabular-nums ml-0.5">({change > 0 ? "+" : ""}{change.toFixed(1)}%)</span>
    </span>
  );
}

export default function DeforestationPage() {
  const { lang } = useLang();
  const [features, setFeatures] = useState<ZoneFeature[]>([]);
  const [selected, setSelected] = useState<ZoneFeature | null>(null);
  const [detail, setDetail] = useState<ZoneDetail | null>(null);
  const [dLoading, setDLoading] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [hasRect, setHasRect] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);

  const toggleDraw = useCallback(() => setDrawMode((prev) => { if (!prev) { setSelected(null); setDetail(null); } return !prev; }), []);
  const close = () => { setSelected(null); setDetail(null); };

  const onRectDraw = useCallback(async (swLat: number, swLng: number, neLat: number, neLng: number) => {
    setHasRect(true); setSelected(null); setDLoading(true); setDetail(null);
    try { const r = await fetch(api("/api/v1/deforestation/analyze-area"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat1: swLat, lon1: swLng, lat2: neLat, lon2: neLng }) });
      if (r.ok) { const d = await r.json(); setDetail(d); setSelected({ id: 0, name: d.zone_name, type: d.zone_type, geojson: "", ndvi_change: d.summary.ndvi_change, cover_change: d.summary.cover_change_pct, trend: d.summary.trend, color: CHART_COLORS[d.summary.trend] || "#94A3B8" }); }
    } catch {} finally { setDLoading(false); }
  }, []);

  const onZoneClick = useCallback(async (z: ZoneFeature) => {
    setSelected(z); setDLoading(true); setDetail(null);
    try { const r = await fetch(api(`/api/v1/deforestation/${z.id}`)); if (r.ok) setDetail(await r.json()); } catch {} finally { setDLoading(false); }
  }, []);

  const yearly = detail?.yearly || [];
  const ndviMin = yearly.length ? Math.min(...yearly.map((p: YearlyPoint) => p.avg_ndvi)) : 0;
  const ndviMax = yearly.length ? Math.max(...yearly.map((p: YearlyPoint) => p.avg_ndvi)) : 1;
  const ndviSpread = (ndviMax - ndviMin) || 0.01;

  const W = 760; const H = 340; const padT = 40; const padR = 25; const padB = 50; const padL = 68;
  const pw = W - padL - padR; const ph = H - padT - padB;

  // Expanded chart dimensions
  const eW = 1100; const eH = 520; const epadT = 50; const epadR = 40; const epadB = 60; const epadL = 80;
  const epw = eW - epadL - epadR; const eph = eH - epadT - epadB;

  const toX = (i: number) => padL + (i / Math.max(1, yearly.length - 1)) * pw;
  const toY = (v: number) => padT + ph * (1 - (v - ndviMin) / ndviSpread);
  const etoX = (i: number) => epadL + (i / Math.max(1, yearly.length - 1)) * epw;
  const etoY = (v: number) => epadT + eph * (1 - (v - ndviMin) / ndviSpread);

  return (
    <div className="relative h-[calc(100vh-64px)] w-full overflow-hidden">
      <DeforestationMapInner onZonesLoaded={setFeatures} onZoneClick={onZoneClick} onRectDraw={onRectDraw} drawMode={drawMode} onDrawEnd={() => setDrawMode(false)} />

      {/* Legend — bottom-left to avoid zoom toggle overlap */}
      <div className="absolute bottom-5 left-5 z-10 rounded-2xl bg-white/95 backdrop-blur-xl px-5 py-4 shadow-xl shadow-slate-200/50 ring-1 ring-slate-200/70">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400 mb-3">Vegetation Health</p>
        {[{ label: "Declining", color: "#DC2626" }, { label: "Stable", color: "#F59E0B" }, { label: "Improving", color: "#16A34A" }].map((t) => (
          <div key={t.label} className="flex items-center gap-3 mb-1.5">
            <span className="h-3 w-3 rounded-full ring-2 ring-offset-1 ring-white" style={{ background: t.color }} />
            <span className="text-[13px] font-medium text-slate-600">{t.label}</span>
          </div>
        ))}
        <div className="mt-3 pt-3 border-t border-slate-100 text-[12px] text-slate-400 font-medium">{features.length} monitored reserves</div>
      </div>

      {/* Toolbar */}
      <div className="absolute top-5 right-5 z-10 flex gap-2">
        <div className="rounded-2xl bg-white/95 backdrop-blur-xl px-5 py-3 shadow-xl shadow-slate-200/50 ring-1 ring-slate-200/70 flex items-center gap-3">
          <Trees className="h-5 w-5 text-emerald-600" />
          <span className="text-[14px] font-bold text-slate-800 tracking-tight">Deforestation Monitor</span>
          <span className="w-px h-5 bg-slate-200" />
          <button onClick={toggleDraw} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all duration-200 ${drawMode ? "bg-blue-600 text-white shadow-md shadow-blue-200" : "bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700"}`}>
            <Square className="h-4 w-4" />{drawMode ? "Drawing..." : "Draw Area"}
          </button>
          {hasRect && <button onClick={() => { setHasRect(false); setSelected(null); setDetail(null); }} className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all duration-200">Clear</button>}
          <a
            href={api(`/api/v1/reports/deforestation?lang=${lang}`)}
            download
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all duration-200"
          >
            <FileDown className="h-4 w-4" />
            AI Report
          </a>
        </div>
      </div>

      {/* Draw mode banner */}
      <AnimatePresence>{drawMode && <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute top-24 left-1/2 -translate-x-1/2 z-10 rounded-xl bg-blue-600 px-6 py-3 text-[14px] font-semibold text-white shadow-xl shadow-blue-200/50"><Crosshair className="inline h-4 w-4 mr-2 -mt-0.5" />Click and drag on the map to draw an analysis rectangle</motion.div>}</AnimatePresence>

      {/* Detail Panel */}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ x: 520 }} animate={{ x: 0 }} exit={{ x: 520 }} transition={{ type: "spring", stiffness: 280, damping: 28 }} className="absolute top-0 right-0 z-20 h-full w-[520px] overflow-y-auto bg-white shadow-2xl border-l border-slate-200/80">
            <div className="sticky top-0 bg-white/95 backdrop-blur-xl z-10 border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <h2 className="text-[18px] font-bold text-slate-900 tracking-tight truncate">{selected.name}</h2>
                <p className="text-[13px] text-slate-500 mt-0.5">{selected.type.replace(/_/g, " ")}{detail?.intersected_zones ? ` · ${detail.intersected_zones} zones` : selected.state ? ` · ${selected.state}` : ""}</p>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl p-2 transition-all"><X className="h-5 w-5" /></button>
            </div>

            {dLoading && <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-[3px] border-emerald-500 border-t-transparent" /></div>}

            {detail?.sea_body && (
              <div className="p-6 flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-2xl bg-blue-50 p-5 mb-5 ring-1 ring-blue-100"><Target className="h-10 w-10 text-blue-400 mx-auto" /></div>
                <h3 className="text-[17px] font-bold text-slate-800 mb-2">Sea / Ocean Body</h3>
                <p className="text-[14px] text-slate-500 leading-relaxed max-w-sm">Vegetation analysis is not available for ocean areas. Please draw a rectangle over land to see deforestation trends.</p>
              </div>
            )}

            {detail && !detail.sea_body && !dLoading && (
              <div className="p-6 space-y-6">
                {detail.intersected_names && detail.intersected_names.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">{detail.intersected_names.map((n) => <span key={n} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{n}</span>)}</div>
                )}

                <div className="flex items-center justify-between">
                  <TrendPill trend={detail.summary.trend} change={detail.summary.ndvi_change * 100} />
                  {detail.area_sq_deg && <span className="text-[12px] text-slate-400 font-medium tabular-nums">{detail.area_sq_deg.toFixed(2)}deg2</span>}
                </div>

                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: `NDVI ${detail.summary.first_year}`, value: detail.summary.first_ndvi.toFixed(4), color: "text-slate-700" },
                    { label: `NDVI ${detail.summary.last_year}`, value: detail.summary.last_ndvi.toFixed(4), color: "text-slate-700" },
                    { label: "Change", value: `${detail.summary.ndvi_change > 0 ? "+" : ""}${(detail.summary.ndvi_change * 100).toFixed(1)}%`, color: detail.summary.ndvi_change < 0 ? "text-red-600" : "text-emerald-600" },
                    { label: "Cover Loss", value: `${Math.abs(detail.summary.cover_change_pct).toFixed(1)}%`, color: "text-amber-600" },
                  ].map((k) => (
                    <motion.div key={k.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="rounded-2xl bg-gradient-to-b from-white to-slate-50 p-4 text-center ring-1 ring-slate-200/60">
                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 mb-1.5">{k.label}</p>
                      <p className={`text-[22px] font-black tabular-nums tracking-tight ${k.color}`}>{k.value}</p>
                    </motion.div>
                  ))}
                </div>

                {/* CHART */}
                <div className="rounded-2xl bg-gradient-to-b from-white to-[#F8FAFC] p-1 ring-1 ring-slate-200/60 overflow-hidden cursor-pointer hover:ring-2 hover:ring-emerald-300 transition-all" onClick={() => setChartExpanded(true)}>
                  <div className="flex items-center gap-2 px-5 pt-5 pb-3">
                    <Calendar className="h-4 w-4 text-emerald-600" />
                    <span className="text-[13px] font-semibold text-slate-700">NDVI Time Series · {detail.summary.first_year} – {detail.summary.last_year}</span>
                    <span className="ml-auto text-[11px] text-slate-400">Click to expand</span>
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block">
                    <defs>
                      <linearGradient id="ndviGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#16A34A" stopOpacity="0.30"/>
                        <stop offset="100%" stopColor="#16A34A" stopOpacity="0.03"/>
                      </linearGradient>
                    </defs>
                    {[0, 0.2, 0.4, 0.6, 0.8, 1].map((frac: number) => {
                      const val = ndviMin + ndviSpread * frac;
                      const y = toY(val);
                      return <g key={frac}><line x1={padL} y1={y} x2={padL + pw} y2={y} stroke="#CBD5E1" strokeWidth={1} strokeDasharray="4 3" /><text x={padL - 12} y={y + 5} textAnchor="end" fill="#475569" fontSize={13} fontWeight={600} fontFamily="system-ui">{val.toFixed(3)}</text></g>;
                    })}
                    {yearly.filter((_: YearlyPoint, i: number) => i % 4 === 0).map((p: YearlyPoint) => { const x = toX(yearly.indexOf(p)); return <text key={p.year} x={x} y={H - 12} textAnchor="middle" fill="#475569" fontSize={13} fontWeight={600} fontFamily="system-ui">{p.year}</text>; })}
                    <path d={`M${toX(0)},${H - padB} ` + yearly.map((p: YearlyPoint, i: number) => `L${toX(i)},${toY(p.avg_ndvi)}`).join(" ") + ` L${toX(yearly.length - 1)},${H - padB} Z`} fill="url(#ndviGrad)" stroke="none" />
                    <path d={yearly.map((p: YearlyPoint, i: number) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(p.avg_ndvi)}`).join(" ")} fill="none" stroke="#16A34A" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
                    {yearly.map((p: YearlyPoint, i: number) => {
                      const x = toX(i); const y = toY(p.avg_ndvi);
                      const pct = yearly[0].avg_ndvi ? ((p.avg_ndvi - yearly[0].avg_ndvi) / yearly[0].avg_ndvi) * 100 : 0;
                      const showLabel = i % 3 === 0;
                      return <g key={p.year}>
                        <circle cx={x} cy={y} r={showLabel ? 5 : 3} fill="white" stroke="#16A34A" strokeWidth={2.5} />
                        {showLabel && <>
                          <text x={x} y={y - 16} textAnchor="middle" fill="#065F46" fontSize={12} fontWeight={700}>{p.avg_ndvi.toFixed(4)}</text>
                          <text x={x} y={y + 20} textAnchor="middle" fill={pct < 0 ? "#DC2626" : "#059669"} fontSize={11} fontWeight={700}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</text>
                        </>}
                      </g>;
                    })}
                  </svg>
                </div>

                <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 p-5 ring-1 ring-slate-200/60">
                  <div className="flex items-center gap-2.5 mb-3"><Activity className="h-4 w-4 text-slate-600" /><span className="text-[13px] font-bold text-slate-700 uppercase tracking-wide">Assessment</span></div>
                  <p className="text-[14px] text-slate-600 leading-relaxed">
                    {detail.summary.trend === "declining"
                      ? <><strong className="text-red-600">Declining trend detected.</strong> Vegetation health has decreased by <strong className="text-red-600">{Math.abs(detail.summary.ndvi_change * 100).toFixed(1)}%</strong> over {detail.summary.last_year - detail.summary.first_year} years, with a forest cover loss of <strong className="text-amber-600">{Math.abs(detail.summary.cover_change_pct).toFixed(1)}%</strong>. This pattern indicates active deforestation or degradation requiring field investigation.</>
                      : detail.summary.trend === "improving"
                        ? <><strong className="text-emerald-600">Positive recovery trend.</strong> NDVI has improved by <strong className="text-emerald-600">{(detail.summary.ndvi_change * 100).toFixed(1)}%</strong> over the monitored period, suggesting successful conservation or natural regeneration.</>
                        : <><strong className="text-amber-600">Stable conditions.</strong> Vegetation health has remained relatively consistent (±{Math.abs(detail.summary.ndvi_change * 100).toFixed(1)}% NDVI variation). Continued monitoring recommended.</>
                    }
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded chart overlay */}
      <AnimatePresence>
        {chartExpanded && detail && yearly.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-center justify-center bg-white/95 backdrop-blur-md"
            onClick={() => setChartExpanded(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} transition={{ duration: 0.25 }}
              className="w-[95%] max-w-[1200px] rounded-3xl bg-white p-8 shadow-2xl ring-1 ring-slate-200/60"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-[22px] font-bold text-slate-900">{detail.zone_name}</h2>
                  <p className="text-[14px] text-slate-500 mt-1">NDVI Time Series · {detail.summary.first_year} – {detail.summary.last_year} · {detail.summary.trend} ({(detail.summary.ndvi_change * 100).toFixed(1)}%)</p>
                </div>
                <button onClick={() => setChartExpanded(false)} className="rounded-xl p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X className="h-6 w-6" /></button>
              </div>
              <svg viewBox={`0 0 ${eW} ${eH}`} width="100%" height={eH} className="block">
                <defs>
                  <linearGradient id="bndviGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16A34A" stopOpacity="0.30"/>
                    <stop offset="100%" stopColor="#16A34A" stopOpacity="0.03"/>
                  </linearGradient>
                </defs>
                {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((frac: number) => {
                  const val = ndviMin + ndviSpread * frac;
                  const y = etoY(val);
                  return <g key={frac}><line x1={epadL} y1={y} x2={epadL + epw} y2={y} stroke="#CBD5E1" strokeWidth={1} strokeDasharray="4 4" /><text x={epadL - 14} y={y + 5} textAnchor="end" fill="#475569" fontSize={14} fontWeight={600} fontFamily="system-ui">{val.toFixed(3)}</text></g>;
                })}
                {yearly.filter((_: YearlyPoint, i: number) => i % 2 === 0).map((p: YearlyPoint) => { const x = etoX(yearly.indexOf(p)); return <text key={p.year} x={x} y={eH - 14} textAnchor="middle" fill="#475569" fontSize={14} fontWeight={600} fontFamily="system-ui">{p.year}</text>; })}
                <path d={`M${etoX(0)},${eH - epadB} ` + yearly.map((p: YearlyPoint, i: number) => `L${etoX(i)},${etoY(p.avg_ndvi)}`).join(" ") + ` L${etoX(yearly.length - 1)},${eH - epadB} Z`} fill="url(#bndviGrad)" stroke="none" />
                <path d={yearly.map((p: YearlyPoint, i: number) => `${i === 0 ? "M" : "L"}${etoX(i)},${etoY(p.avg_ndvi)}`).join(" ")} fill="none" stroke="#16A34A" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
                {yearly.map((p: YearlyPoint, i: number) => {
                  const x = etoX(i); const y = etoY(p.avg_ndvi);
                  const pct = yearly[0].avg_ndvi ? ((p.avg_ndvi - yearly[0].avg_ndvi) / yearly[0].avg_ndvi) * 100 : 0;
                  const showLabel = i % 2 === 0;
                  return <g key={p.year}>
                    <circle cx={x} cy={y} r={showLabel ? 6 : 3.5} fill="white" stroke="#16A34A" strokeWidth={3} />
                    {showLabel && <>
                      <text x={x} y={y - 18} textAnchor="middle" fill="#065F46" fontSize={14} fontWeight={700}>{p.avg_ndvi.toFixed(4)}</text>
                      <text x={x} y={y + 22} textAnchor="middle" fill={pct < 0 ? "#DC2626" : "#059669"} fontSize={12} fontWeight={700}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</text>
                    </>}
                  </g>;
                })}
              </svg>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
