"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, Pause, Play } from "lucide-react";

export interface ImagerySnapshot { id: string; date: string; label: string; tileUrl: string; }
interface Props { snapshots: ImagerySnapshot[]; selectedId: string; onSelect: (id: string) => void; }

export default function HistoricalTimeline({ snapshots, selectedId, onSelect }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const selectedIndex = Math.max(0, snapshots.findIndex((item) => item.id === selectedId));
  const selected = snapshots[selectedIndex];
  const move = (direction: -1 | 1) => onSelect(snapshots[Math.min(snapshots.length - 1, Math.max(0, selectedIndex + direction))].id);
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => onSelect(snapshots[selectedIndex === snapshots.length - 1 ? 0 : selectedIndex + 1].id), 1800);
    return () => window.clearInterval(timer);
  }, [isPlaying, onSelect, selectedIndex, snapshots]);
  return <section className="absolute inset-x-0 top-0 z-[700] min-h-[82px] bg-[#171717]/95 text-white shadow-xl backdrop-blur-md">
    <div className="mx-auto flex min-h-[82px] max-w-[1440px] items-center gap-3 px-4 sm:px-6">
      <div className="flex min-w-fit items-center gap-3 border-r border-white/15 pr-4 sm:pr-5"><div className="hidden h-11 w-11 items-center justify-center rounded-full bg-white/10 sm:flex"><Clock3 className="h-5 w-5 text-sky-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">Historical imagery</p><p className="text-sm font-bold tabular-nums sm:text-base">{selected.date}</p></div></div>
      <button aria-label="Previous imagery" onClick={() => move(-1)} disabled={selectedIndex === 0} className="rounded-full p-2 text-white/75 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button>
      <button aria-label={isPlaying ? "Pause timeline" : "Play timeline"} onClick={() => setIsPlaying((value) => !value)} className="rounded-full bg-white/10 p-2 transition hover:bg-white/20">{isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}</button>
      <div className="min-w-0 flex-1"><div className="grid min-w-[440px] grid-cols-8 items-start" role="listbox" aria-label="Available historical imagery">{snapshots.map((snapshot, index) => { const active = snapshot.id === selectedId; const past = index < selectedIndex; return <button key={snapshot.id} type="button" role="option" aria-selected={active} title={`View imagery published ${snapshot.date}`} onClick={() => onSelect(snapshot.id)} className="group relative flex min-w-0 flex-col items-center pt-1 text-center focus:outline-none"><span className={`absolute left-0 right-0 top-[11px] h-1 ${index === 0 ? "rounded-l-full" : ""} ${index === snapshots.length - 1 ? "rounded-r-full" : ""} ${past || active ? "bg-blue-500" : "bg-white/20"}`} /><span className={`relative z-10 h-5 w-5 rounded-full border-[3px] transition ${active ? "scale-125 border-blue-200 bg-blue-400 shadow-[0_0_0_4px_rgba(59,130,246,.25)]" : past ? "border-blue-200 bg-blue-500 group-hover:scale-110" : "border-[#171717] bg-white/70 group-hover:scale-110 group-hover:bg-white"}`} /><span className={`mt-1 truncate text-[10px] font-bold sm:text-xs ${active ? "text-white" : "text-white/55 group-hover:text-white"}`}>{snapshot.label}</span></button>; })}</div></div>
      <button aria-label="Next imagery" onClick={() => move(1)} disabled={selectedIndex === snapshots.length - 1} className="rounded-full p-2 text-white/75 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
    </div>
  </section>;
}
