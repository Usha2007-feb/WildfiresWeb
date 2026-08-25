"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  Eye,
  EyeOff,
  Layers,
  ScanSearch,
  ChevronRight,
  MapPin,
  Satellite,
} from "lucide-react";
import { REGIONS } from "@/components/encroachment/encroachmentData";
import type { RegionConfig } from "@/components/encroachment/encroachmentData";
import RegionSelector from "@/components/encroachment/RegionSelector";
import ChangeStatsPanel from "@/components/encroachment/ChangeStatsPanel";
import type { AnalysisResult } from "@/components/encroachment/ChangeStatsPanel";
import type { ChangeFeature } from "@/components/encroachment/EncroachmentMap";
import LayerSwitcher, { type LayerKey } from "@/components/encroachment/LayerSwitcher";
import YearSelector from "@/components/encroachment/YearSelector";
import { api } from "@/lib/constants";

// Leaflet must be loaded client-side only
const EncroachmentMapInner = dynamic(
  () => import("@/components/encroachment/EncroachmentMap"),
  { ssr: false }
);

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_BEFORE = 2019;
const DEFAULT_AFTER  = 2023;

// ── Helpers ────────────────────────────────────────────────────────────────

function buildIndexTileUrl(
  region: string,
  layer: LayerKey,
  year: number
): string | null {
  // True Colour is the Esri World Imagery basemap supplied by the map itself.
  // The locally generated rasters are index products, not RGB photographs.
  if (layer === "truecolor") {
    return null;
  }
  if (layer === "lc" || layer === "change") {
    // These are served via the analysis result's feature layer, not a tile URL
    return null;
  }
  // ndvi / evi / nbr / ndmi / bsi
  return api(`/api/v1/encroachment/${region}/${year}/index/${layer}/{z}/{x}/{y}.png`);
}

// ── Page component ─────────────────────────────────────────────────────────

export default function EncroachmentPage() {
  const [activeRegion, setActiveRegion]     = useState<RegionConfig>(REGIONS[0]);
  const [beforeYear, setBeforeYear]         = useState(DEFAULT_BEFORE);
  const [afterYear,  setAfterYear]          = useState(DEFAULT_AFTER);
  const [availableYears, setAvailableYears] = useState<number[]>([DEFAULT_BEFORE, DEFAULT_AFTER]);
  const [activeLayer, setActiveLayer]       = useState<LayerKey>("truecolor");
  const [showEncroachment, setShowEncroachment] = useState(true);
  const [panelOpen, setPanelOpen]           = useState(false);
  const [analysis, setAnalysis]             = useState<AnalysisResult | null>(null);
  const [changeFeatures, setChangeFeatures] = useState<ChangeFeature[]>([]);
  const [analysisError, setAnalysisError]   = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);

  // ── Fetch available years per region ────────────────────────────────────
  useEffect(() => {
    fetch(api("/api/v1/encroachment/status"))
      .then((r) => r.json())
      .then((data) => {
        const regionStatus = (data.regions as { id: string; available_years: number[] }[]).find(
          (r) => r.id === activeRegion.id
        );
        if (regionStatus?.available_years?.length) {
          const years = regionStatus.available_years;
          setAvailableYears(years);
          // Reset before/after if current selection is outside available range
          if (!years.includes(beforeYear)) setBeforeYear(years[0]);
          if (!years.includes(afterYear))  setAfterYear(years[years.length - 1]);
        }
      })
      .catch(() => {/* use defaults */});
  }, [activeRegion.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run analysis when region/years change ───────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    setAnalysisLoading(true);
    setAnalysis(null);
    setChangeFeatures([]);
    setAnalysisError(null);

    fetch(
      api(`/api/v1/encroachment/${activeRegion.id}/analysis?before=${beforeYear}&after=${afterYear}`),
      { signal: controller.signal }
    )
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          throw new Error(
            typeof body.detail === "object"
              ? body.detail.message
              : body.detail || "Unable to run analysis"
          );
        }
        return body;
      })
      .then(
        (result: AnalysisResult & { features: { features: ChangeFeature[] } }) => {
          setAnalysis(result);
          setChangeFeatures(result.features?.features ?? []);
        }
      )
      .catch((err: Error) => {
        if (err.name !== "AbortError") setAnalysisError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAnalysisLoading(false);
      });

    return () => controller.abort();
  }, [activeRegion.id, beforeYear, afterYear]);

  const handleRegionSelect = useCallback((r: RegionConfig) => {
    setActiveRegion(r);
    setPanelOpen(false);
  }, []);

  // ── Derive the tile URL for the active layer ─────────────────────────────
  const indexTileUrl = buildIndexTileUrl(activeRegion.id, activeLayer, afterYear);

  // ── Status label ─────────────────────────────────────────────────────────
  const statusLabel = analysisLoading
    ? "Computing RF analysis…"
    : analysis
    ? `${beforeYear} → ${afterYear} · ${analysis.summary.candidate_area_ha.toFixed(1)} ha detected`
    : "Imagery required";

  return (
    <div className="relative h-[calc(100vh-64px)] w-full overflow-hidden bg-slate-900">

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <EncroachmentMapInner
        region={activeRegion}
        indexTileUrl={indexTileUrl}
        showEncroachment={showEncroachment}
        changeFeatures={changeFeatures}
        activeLayer={activeLayer}
        beforeYear={beforeYear}
        afterYear={afterYear}
      />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="absolute inset-x-0 top-0 z-[700] h-[64px] bg-[#0F172A]/90 backdrop-blur-md flex items-center px-4 gap-3 shadow-xl">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/15 ring-1 ring-orange-400/30">
            <ScanSearch className="h-5 w-5 text-orange-400" />
          </div>
          <div>
            <p className="text-[13px] font-black text-white leading-tight">
              Encroachment Detection
            </p>
            <p className="text-[11px] text-white/40 tabular-nums">{statusLabel}</p>
          </div>
        </div>

        <div className="h-8 w-px bg-white/10 mx-1" />

        {/* Pipeline badge */}
        <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 ring-1 ring-emerald-400/20">
          <Satellite className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[11px] font-semibold text-emerald-400">
            Sentinel-2 · NDVI/EVI/NBR/NDMI/BSI · Random Forest
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Toggle encroachment polygons */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowEncroachment((v) => !v)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[12px] font-semibold shadow-sm ring-1 transition-all ${
              showEncroachment
                ? "bg-red-500/90 text-white ring-red-400/50"
                : "bg-white/8 text-white/60 ring-white/10 hover:ring-white/20"
            }`}
          >
            {showEncroachment ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
            {showEncroachment ? "Encroachments On" : "Encroachments Off"}
          </motion.button>

          {/* Open report panel */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setPanelOpen((v) => !v)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[12px] font-semibold shadow-sm ring-1 transition-all ${
              panelOpen
                ? "bg-white text-slate-900 ring-white/80"
                : "bg-white/8 text-white/60 ring-white/10 hover:ring-white/20"
            }`}
          >
            <Layers className="h-4 w-4" />
            Analysis Report
            <ChevronRight
              className={`h-4 w-4 transition-transform ${panelOpen ? "rotate-180" : ""}`}
            />
          </motion.button>
        </div>
      </div>

      {/* ── Region selector (left, below top bar) ───────────────────────── */}
      <RegionSelector
        regions={REGIONS}
        selected={activeRegion}
        onSelect={handleRegionSelect}
      />

      {/* ── Year selector (right, below top bar) ────────────────────────── */}
      <YearSelector
        beforeYear={beforeYear}
        afterYear={afterYear}
        availableYears={availableYears}
        onBeforeChange={setBeforeYear}
        onAfterChange={setAfterYear}
        loading={analysisLoading}
      />

      {/* ── Layer switcher (bottom-left) ─────────────────────────────────── */}
      <LayerSwitcher
        activeLayer={activeLayer}
        onSelect={setActiveLayer}
        activeYear={afterYear}
      />

      {/* ── Loading progress overlay ─────────────────────────────────────── */}
      <AnimatePresence>
        {analysisLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-5 right-5 z-[400] flex items-center gap-3 rounded-2xl bg-[#0F172A]/90 backdrop-blur-xl px-5 py-3 shadow-xl ring-1 ring-white/10"
          >
            <motion.div
              className="h-5 w-5 rounded-full border-2 border-t-sky-400 border-white/20"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
            />
            <span className="text-[12px] text-white/70">
              Running pipeline…
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Analysis report panel ───────────────────────────────────────── */}
      <ChangeStatsPanel
        region={activeRegion}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        analysis={analysis}
        loading={analysisLoading}
        error={analysisError}
      />
    </div>
  );
}
