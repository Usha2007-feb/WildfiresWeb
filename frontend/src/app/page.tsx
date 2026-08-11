"use client";

import dynamic from "next/dynamic";
import { useAppStore } from "@/stores/appStore";
import TopBar from "@/components/layout/TopBar";
import Legend from "@/components/panels/Legend";
import LayerControls from "@/components/panels/LayerControls";
import ForestFilter from "@/components/panels/ForestFilter";
import PredictionModal from "@/components/overlays/PredictionModal";
import TopRisksPanel from "@/components/panels/TopRisksPanel";
import { api } from "@/lib/constants";
import { FileDown } from "lucide-react";
import { useLang } from "@/components/auth/LanguageProvider";

const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-100">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
    </div>
  ),
});

export default function Home() {
  const activeReserve = useAppStore((s) => s.activeReserve);
  const setActiveReserve = useAppStore((s) => s.setActiveReserve);
  const { lang, t } = useLang();

  return (
    <main className="relative h-[calc(100vh-64px)] w-full overflow-hidden">
      <MapView />
      <TopBar />
      <ForestFilter active={activeReserve} onChange={(r) => setActiveReserve(r.id)} />
      <TopRisksPanel />
      <LayerControls />
      <Legend />
      <PredictionModal />
      <a
        href={api(`/api/v1/reports/fire-risk?lang=${lang}`)}
        download
        className="absolute bottom-4 right-4 z-30 flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[12px] font-bold text-blue-600 shadow-lg ring-1 ring-slate-200/80 hover:bg-blue-50 transition-all"
      >
        <FileDown className="h-4 w-4" />
        {t("dashboard", "report")}
      </a>
    </main>
  );
}
