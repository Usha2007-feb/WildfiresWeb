"use client";

import { motion } from "framer-motion";
import {
  Satellite,
  BarChart3,
  Layers,
  TreePine,
  Flame,
  Droplets,
  Activity,
  Globe,
} from "lucide-react";

export type LayerKey =
  | "truecolor"
  | "ndvi"
  | "evi"
  | "nbr"
  | "ndmi"
  | "bsi"
  | "lc"
  | "change";

export interface LayerDef {
  id: LayerKey;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  accent: string;
  isIndex: boolean;
}

export const LAYER_DEFS: LayerDef[] = [
  {
    id: "truecolor",
    label: "True Colour",
    sublabel: "Esri World Imagery",
    icon: <Satellite className="h-3.5 w-3.5" />,
    accent: "#64748B",
    isIndex: false,
  },
  {
    id: "ndvi",
    label: "ΔNDVI",
    sublabel: "Vegetation loss",
    icon: <TreePine className="h-3.5 w-3.5" />,
    accent: "#16A34A",
    isIndex: true,
  },
  {
    id: "evi",
    label: "ΔEVI",
    sublabel: "Dense-forest health",
    icon: <Activity className="h-3.5 w-3.5" />,
    accent: "#22C55E",
    isIndex: true,
  },
  {
    id: "nbr",
    label: "ΔNBR",
    sublabel: "Fire / disturbance",
    icon: <Flame className="h-3.5 w-3.5" />,
    accent: "#F97316",
    isIndex: true,
  },
  {
    id: "ndmi",
    label: "ΔNDMI",
    sublabel: "Canopy moisture",
    icon: <Droplets className="h-3.5 w-3.5" />,
    accent: "#38BDF8",
    isIndex: true,
  },
  {
    id: "bsi",
    label: "ΔBSI",
    sublabel: "Bare soil exposure",
    icon: <Globe className="h-3.5 w-3.5" />,
    accent: "#D97706",
    isIndex: true,
  },
  {
    id: "lc",
    label: "Land Cover",
    sublabel: "RF classification",
    icon: <BarChart3 className="h-3.5 w-3.5" />,
    accent: "#8B5CF6",
    isIndex: false,
  },
  {
    id: "change",
    label: "Change Map",
    sublabel: "Deforestation classes",
    icon: <Layers className="h-3.5 w-3.5" />,
    accent: "#DC2626",
    isIndex: false,
  },
];

interface Props {
  activeLayer: LayerKey;
  onSelect: (layer: LayerKey) => void;
  activeYear: number;
}

export default function LayerSwitcher({ activeLayer, onSelect, activeYear }: Props) {
  return (
    <div className="absolute left-5 bottom-40 z-[400]">
      <div className="rounded-2xl bg-[#0F172A]/92 backdrop-blur-xl shadow-2xl shadow-black/40 ring-1 ring-white/10 overflow-y-auto w-[210px] max-h-[calc(100vh-34rem)]">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <Layers className="h-4 w-4 text-sky-400 shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-sky-400">
            Map Layers
          </span>
          <span className="ml-auto text-[10px] text-white/40 tabular-nums">{activeYear}</span>
        </div>

        {/* Layer buttons */}
        <div className="py-1.5">
          {LAYER_DEFS.map((layer) => {
            const active = layer.id === activeLayer;
            return (
              <motion.button
                key={layer.id}
                onClick={() => onSelect(layer.id)}
                whileTap={{ scale: 0.97 }}
                className={`relative w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 ${
                  active ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="layer-indicator"
                    className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full"
                    style={{ backgroundColor: layer.accent }}
                    transition={{ type: "spring", stiffness: 400, damping: 35 }}
                  />
                )}
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-lg shrink-0 transition-all"
                  style={{
                    backgroundColor: active
                      ? `${layer.accent}30`
                      : "rgba(255,255,255,0.08)",
                    color: active ? layer.accent : "rgba(255,255,255,0.5)",
                  }}
                >
                  {layer.icon}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-[12px] font-bold leading-tight ${
                      active ? "text-white" : "text-white/70"
                    }`}
                  >
                    {layer.label}
                  </span>
                  <span className="block truncate text-[10px] text-white/35 mt-0.5">
                    {layer.sublabel}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* Colourmap scale bar for index layers */}
        {LAYER_DEFS.find((l) => l.id === activeLayer)?.isIndex && (
          <div className="border-t border-white/10 px-4 py-3">
            <div
              className="h-2 w-full rounded-full"
              style={{
                background:
                  activeLayer === "bsi"
                    ? "linear-gradient(to right, #3B82F6, #ffffff, #EF4444)"
                    : "linear-gradient(to right, #EF4444, #EAB308, #22C55E)",
              }}
            />
            <div className="mt-1 flex justify-between text-[9px] text-white/40">
              <span>{activeLayer === "bsi" ? "Vegetated" : "Loss"}</span>
              <span>0</span>
              <span>{activeLayer === "bsi" ? "Bare" : "Stable"}</span>
            </div>
          </div>
        )}

        {/* Change-class legend */}
        {activeLayer === "change" && (
          <div className="border-t border-white/10 px-4 py-3 space-y-1.5">
            {[
              { color: "#F97316", label: "Degradation" },
              { color: "#DC2626", label: "Deforestation" },
              { color: "#EAB308", label: "New agriculture" },
              { color: "#7C3AED", label: "New settlement" },
              { color: "#7F1D1D", label: "Burn disturbance" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-sm shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-[10px] text-white/55">{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* LC class legend */}
        {activeLayer === "lc" && (
          <div className="border-t border-white/10 px-4 py-3 space-y-1.5">
            {[
              { color: "#22863A", label: "Forest" },
              { color: "#F59E0B", label: "Agriculture" },
              { color: "#92400E", label: "Settlement" },
              { color: "#D97706", label: "Bare soil" },
              { color: "#3B82F6", label: "Water" },
              { color: "#86EFAC", label: "Other veg." },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-sm shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-[10px] text-white/55">{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
