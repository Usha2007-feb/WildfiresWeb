import { create } from "zustand";

const RESERVE_BOUNDS: Record<string, [[number, number], [number, number]]> = {
  all: [[6.5, 67.0], [38.0, 98.0]],
  corbett: [[29.44, 78.68], [29.65, 79.12]],
  kanha: [[22.24, 80.42], [22.41, 80.74]],
  periyar: [[9.44, 77.00], [9.64, 77.33]],
  similipal: [[21.68, 86.05], [21.88, 86.45]],
  kaziranga: [[26.56, 93.02], [26.73, 93.38]],
};

interface AppState {
  viewState: { latitude: number; longitude: number; zoom: number };
  setViewState: (s: Partial<AppState["viewState"]>) => void;

  predictionMode: boolean;
  setPredictionMode: (m: boolean) => void;

  heatmapVisible: boolean;
  setHeatmapVisible: (v: boolean) => void;
  firmsVisible: boolean;
  setFirmsVisible: (v: boolean) => void;

  selectedPoint: { lat: number; lon: number } | null;
  setSelectedPoint: (p: { lat: number; lon: number } | null) => void;

  activeReserve: string;
  setActiveReserve: (r: string) => void;
  getReserveBounds: (r: string) => [[number, number], [number, number]];

  flyTo: { lat: number; lon: number; zoom: number } | null;
  setFlyTo: (p: { lat: number; lon: number; zoom: number } | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  viewState: { latitude: 22.5, longitude: 78.5, zoom: 5.8 },
  setViewState: (p) => set((s) => ({ viewState: { ...s.viewState, ...p } })),

  predictionMode: false,
  setPredictionMode: (m) => set({ predictionMode: m }),

  heatmapVisible: true,
  setHeatmapVisible: (v) => set({ heatmapVisible: v }),
  firmsVisible: false,
  setFirmsVisible: (v) => set({ firmsVisible: v }),

  selectedPoint: null,
  setSelectedPoint: (p) => set({ selectedPoint: p }),

  activeReserve: "all",
  setActiveReserve: (r) => set({ activeReserve: r }),
  getReserveBounds: (r) => RESERVE_BOUNDS[r] || RESERVE_BOUNDS.all,

  flyTo: null,
  setFlyTo: (p) => set({ flyTo: p }),
}));
