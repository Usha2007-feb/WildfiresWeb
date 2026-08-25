"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  LoaderCircle,
  TrendingDown,
  TreePine,
  X,
} from "lucide-react";
import type { RegionConfig } from "./encroachmentData";

// ── Types mirroring the backend response ────────────────────────────────────

export interface AnalysisResult {
  status: "complete";
  before_year: number;
  after_year: number;
  summary: {
    candidate_area_ha: number;
    candidate_zones: number;
    mean_index_deltas: Record<string, number>;
  };
  method: {
    indices: string[];
    classification: string;
    accuracy: null;
    accuracy_note: string;
  };
  land_cover?: {
    before: Record<string, number>;
    after: Record<string, number>;
    class_colors: Record<string, string>;
  };
  change_classes?: {
    areas: Record<string, number>;
    class_colors: Record<string, string>;
  };
}

interface Props {
  region: RegionConfig;
  open: boolean;
  onClose: () => void;
  analysis: AnalysisResult | null;
  loading: boolean;
  error: string | null;
}

// ── Small helpers ────────────────────────────────────────────────────────────

function ColorDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
      style={{ backgroundColor: color }}
    />
  );
}

function StatRow({
  label,
  before,
  after,
  color,
}: {
  label: string;
  before: number;
  after: number;
  color: string;
}) {
  const diff = after - before;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <ColorDot color={color} />
      <span className="flex-1 text-slate-600 truncate">{label}</span>
      <span className="tabular-nums text-slate-700 font-semibold w-16 text-right">
        {before.toFixed(1)} ha
      </span>
      <span className="tabular-nums text-slate-700 font-semibold w-16 text-right">
        {after.toFixed(1)} ha
      </span>
      <span
        className="tabular-nums w-16 text-right font-bold"
        style={{ color: diff < -1 ? "#DC2626" : diff > 1 ? "#16A34A" : "#94A3B8" }}
      >
        {diff > 0 ? "+" : ""}
        {diff.toFixed(1)}
      </span>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export default function ChangeStatsPanel({
  region,
  open,
  onClose,
  analysis,
  loading,
  error,
}: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 480 }}
          animate={{ x: 0 }}
          exit={{ x: 480 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="absolute right-5 top-20 z-[500] h-[calc(100%-7rem)] w-[460px] overflow-y-auto rounded-[26px] border border-white/12 bg-[#11151d]/94 text-white shadow-[0_24px_70px_rgba(0,0,0,.55)] backdrop-blur-2xl"
        >
          {/* ── Header ────────────────────────────────────────────────── */}
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/10 bg-[#11151d]/88 px-6 py-4 backdrop-blur-xl">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-300" />
                <span className="text-[11px] font-bold uppercase tracking-[.15em] text-amber-300">
                  Encroachment Report
                </span>
              </div>
              <h2 className="text-[17px] font-black text-white">{region.name}</h2>
              <p className="mt-0.5 text-[12px] text-white/45">
                Real Sentinel-2 analysis only
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="space-y-5 p-6">
            {/* ── Loading ───────────────────────────────────────────── */}
            {loading && (
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-white/70">
                <LoaderCircle className="h-5 w-5 animate-spin text-sky-300" />
                Running RF classification and index analysis…
              </div>
            )}

            {/* ── Error ─────────────────────────────────────────────── */}
            {!loading && error && (
              <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-5 text-sm leading-relaxed text-amber-100">
                <b>Analysis not available yet.</b>
                <br />
                {error}
              </div>
            )}

            {/* ── Results ───────────────────────────────────────────── */}
            {!loading && analysis && (
              <>
                {/* Hero metric */}
                <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800 to-[#090c12] p-5 text-white shadow-inner shadow-black/30">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-[.15em] text-slate-400">
                    Forest-loss candidates ({analysis.before_year} → {analysis.after_year})
                  </p>
                  <div className="flex items-end gap-2">
                    <strong className="text-[42px] leading-none">
                      {analysis.summary.candidate_area_ha.toFixed(2)}
                    </strong>
                    <span className="pb-1 text-lg font-bold text-slate-400">ha</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {analysis.summary.candidate_zones} mapped area(s) · field verification required
                  </p>
                </section>

                {/* Mean change signals */}
                <section>
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-[.15em] text-white/45">
                    Mean Δ index signals
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(analysis.summary.mean_index_deltas).map(([idx, val]) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-white/10 bg-white/[.055] p-3"
                      >
                        <p className="text-[10px] font-bold uppercase text-white/40">Δ{idx}</p>
                        <p
                          className="mt-1 text-[16px] font-black"
                          style={{ color: val > 0.05 ? "#DC2626" : "#16A34A" }}
                        >
                          {val > 0 ? "+" : ""}
                          {val.toFixed(4)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Land-cover comparison */}
                {analysis.land_cover &&
                  Object.keys(analysis.land_cover.before).length > 0 && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <TreePine className="h-4 w-4 text-emerald-600" />
                        <p className="text-[11px] font-bold uppercase tracking-[.15em] text-white/45">
                          Land Cover (RF classification)
                        </p>
                      </div>
                      {/* Column headers */}
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-slate-400 mb-1.5 px-0.5">
                        <span className="w-2.5" />
                        <span className="flex-1">Class</span>
                        <span className="w-16 text-right">{analysis.before_year}</span>
                        <span className="w-16 text-right">{analysis.after_year}</span>
                        <span className="w-16 text-right">Change</span>
                      </div>
                      <div className="space-y-1.5">
                        {Object.entries(analysis.land_cover.before).map(([cls, beforeHa]) => (
                          <StatRow
                            key={cls}
                            label={cls}
                            before={beforeHa}
                            after={analysis.land_cover!.after[cls] ?? 0}
                            color={analysis.land_cover!.class_colors[cls] ?? "#94A3B8"}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                {/* Change class breakdown */}
                {analysis.change_classes &&
                  Object.values(analysis.change_classes.areas).some((v) => v > 0) && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <TrendingDown className="h-4 w-4 text-red-500" />
                        <p className="text-[11px] font-bold uppercase tracking-[.15em] text-white/45">
                          Change Classification
                        </p>
                      </div>
                      <div className="space-y-2">
                        {Object.entries(analysis.change_classes.areas)
                          .filter(([cls]) => cls !== "No significant change")
                          .sort(([, a], [, b]) => b - a)
                          .map(([cls, ha]) => {
                            const color =
                              analysis.change_classes!.class_colors[cls] ?? "#94A3B8";
                            const total = Object.values(
                              analysis.change_classes!.areas
                            ).reduce((sum, v) => sum + v, 0);
                            const pct = total > 0 ? (ha / total) * 100 : 0;
                            return (
                              <div key={cls}>
                                <div className="flex items-center justify-between mb-0.5">
                                  <div className="flex items-center gap-2">
                                    <ColorDot color={color} />
                                    <span className="text-[12px] text-slate-600">{cls}</span>
                                  </div>
                                  <span className="text-[12px] font-bold text-slate-800 tabular-nums">
                                    {ha.toFixed(1)} ha
                                  </span>
                                </div>
                                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                  <motion.div
                                    className="h-full rounded-full"
                                    style={{ backgroundColor: color }}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${pct}%` }}
                                    transition={{ duration: 0.6, ease: "easeOut" }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </section>
                  )}

                {/* Method block */}
                <section className="rounded-2xl border border-sky-300/15 bg-sky-400/10 p-4 text-[12px] leading-relaxed text-sky-100">
                  <CheckCircle2 className="mb-2 h-4 w-4 text-sky-300" />
                  <b>Method:</b> {analysis.method.indices.join(" + ")}
                  <br />
                  {analysis.method.classification}
                </section>

                {/* Accuracy — pending */}
                <section className="rounded-2xl border border-dashed border-white/20 bg-white/[.03] p-4 text-[12px] leading-relaxed text-white/55">
                  <div className="flex items-start gap-2">
                    <Clock className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" />
                    <div>
                      <b className="text-white/85">Accuracy Assessment</b>
                      <br />
                      {analysis.method.accuracy_note}
                    </div>
                  </div>
                </section>

                {/* Disclaimer */}
                <section className="flex gap-2.5 rounded-xl border border-amber-300/15 bg-amber-400/10 px-4 py-3 text-[11px] leading-relaxed text-amber-100">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  Detected polygons are machine-generated change candidates. Field
                  verification and labelled validation samples are required before
                  operational use.
                </section>
              </>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
