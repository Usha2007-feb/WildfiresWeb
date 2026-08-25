"use client";

import { useState } from "react";
import { CalendarRange, Play, Sparkles } from "lucide-react";

interface Props {
  beforeYear: number;
  afterYear: number;
  availableYears: number[];
  onBeforeChange: (year: number) => void;
  onAfterChange: (year: number) => void;
  loading?: boolean;
}

export default function YearSelector({ beforeYear, afterYear, availableYears, onBeforeChange, onAfterChange, loading }: Props) {
  const [editing, setEditing] = useState<"before" | "after">("after");
  const years = [...availableYears].sort((a, b) => a - b);
  const min = years[0] ?? beforeYear;
  const max = years[years.length - 1] ?? afterYear;
  const selectYear = (year: number) => {
    if (editing === "before" && year < afterYear) onBeforeChange(year);
    if (editing === "after" && year > beforeYear) onAfterChange(year);
  };

  return <section className="absolute bottom-5 left-1/2 z-[450] w-[min(760px,calc(100vw-3rem))] -translate-x-1/2">
    <div className="rounded-[24px] border border-white/15 bg-[#11151ddd]/90 px-5 py-4 shadow-[0_18px_55px_rgba(0,0,0,.48)] backdrop-blur-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-white/85"><span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-400/15 text-sky-300"><CalendarRange className="h-4 w-4" /></span><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-white/45">Historical imagery</p><p className="text-xs font-semibold">Select comparison period</p></div></div>
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/25 p-1 text-[11px] font-bold">
          <button onClick={() => setEditing("before")} className={`rounded-full px-3 py-1.5 transition ${editing === "before" ? "bg-white text-slate-950 shadow" : "text-white/55 hover:text-white"}`}>Before {beforeYear}</button>
          <button onClick={() => setEditing("after")} className={`rounded-full px-3 py-1.5 transition ${editing === "after" ? "bg-sky-400 text-slate-950 shadow shadow-sky-500/25" : "text-white/55 hover:text-white"}`}>After {afterYear}</button>
        </div>
      </div>
      <div className="relative flex items-start justify-between px-1">
        <div className="absolute left-3 right-3 top-[9px] h-[2px] rounded-full bg-white/15" />
        <div className="absolute top-[9px] h-[2px] rounded-full bg-gradient-to-r from-white to-sky-400" style={{ left: `${12 + ((beforeYear - min) / Math.max(1, max - min)) * 76}%`, right: `${12 + ((max - afterYear) / Math.max(1, max - min)) * 76}%` }} />
        {years.map((year) => {
          const isBefore = year === beforeYear; const isAfter = year === afterYear; const inRange = year > beforeYear && year < afterYear;
          return <button key={year} type="button" onClick={() => selectYear(year)} title={`Set ${editing} year to ${year}`} className="group relative z-10 flex min-w-10 flex-col items-center gap-2 focus:outline-none disabled:cursor-not-allowed" disabled={(editing === "before" && year >= afterYear) || (editing === "after" && year <= beforeYear)}>
            <span className={`grid h-5 w-5 place-items-center rounded-full border-2 transition ${isBefore ? "border-white bg-white shadow-[0_0_0_5px_rgba(255,255,255,.12)]" : isAfter ? "border-sky-100 bg-sky-400 shadow-[0_0_0_5px_rgba(56,189,248,.18)]" : inRange ? "border-sky-300 bg-sky-400/70" : "border-white/35 bg-[#11151d] group-hover:border-white/80"}`}>{isAfter && <Play className="h-2.5 w-2.5 fill-slate-950 text-slate-950" />}</span>
            <span className={`text-[11px] font-bold tabular-nums transition ${isBefore || isAfter ? "text-white" : "text-white/45 group-hover:text-white/80"}`}>{year}</span>
          </button>;
        })}
      </div>
      <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-white/45"><Sparkles className="h-3 w-3 text-sky-300" />{loading ? "Refreshing satellite analysis…" : `${beforeYear} → ${afterYear} · Sentinel-2 comparison ready`}</div>
    </div>
  </section>;
}
