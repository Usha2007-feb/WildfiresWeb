"use client";

import { motion } from "framer-motion";
import { MapPin } from "lucide-react";
import type { RegionConfig } from "./encroachmentData";

const STATE_LABELS: Record<string, string> = { laisong: "Assam", corbett: "Uttarakhand", jyotikuchi: "Assam", similipal: "Odisha" };
interface Props { regions: RegionConfig[]; selected: RegionConfig; onSelect: (r: RegionConfig) => void; }

export default function RegionSelector({ regions, selected, onSelect }: Props) {
  return <div className="absolute left-5 top-24 z-[400] flex flex-col gap-2">
    <div className="flex items-center gap-2.5 rounded-2xl border border-white/15 bg-[#11151d]/88 px-4 py-3 shadow-[0_14px_35px_rgba(0,0,0,.35)] backdrop-blur-2xl"><MapPin className="h-4 w-4 shrink-0 text-sky-300" /><span className="text-[11px] font-bold uppercase tracking-[.16em] text-white/75">Case-study regions</span></div>
    <div className="flex flex-col gap-1.5">{regions.map((region) => { const active = region.id === selected.id; return <motion.button key={region.id} onClick={() => onSelect(region)} whileHover={{ scale: 1.02 }} whileTap={{ scale: .98 }} className={`group relative flex items-center gap-3 rounded-xl px-4 py-3 text-left shadow-lg transition-all duration-200 ${active ? "border border-sky-300/40 bg-sky-400/15 shadow-sky-950/30" : "border border-white/10 bg-[#11151d]/82 backdrop-blur-2xl hover:border-white/25 hover:bg-white/10"}`}>
      {active && <motion.div layoutId="region-active" className="absolute inset-0 rounded-xl bg-sky-400/10" transition={{ type: "spring", stiffness: 400, damping: 35 }} />}
      <div className="relative min-w-0"><span className={`block truncate text-[13px] font-bold leading-tight ${active ? "text-white" : "text-white/80"}`}>{region.id.charAt(0).toUpperCase() + region.id.slice(1)}</span><span className={`mt-0.5 block truncate text-[11px] ${active ? "text-sky-100/65" : "text-white/40"}`}>{STATE_LABELS[region.id]}</span></div>
      <span className={`relative ml-auto h-2 w-2 shrink-0 rounded-full ${active ? "bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,.85)]" : "bg-white/20"}`} />
    </motion.button>; })}</div>
  </div>;
}
