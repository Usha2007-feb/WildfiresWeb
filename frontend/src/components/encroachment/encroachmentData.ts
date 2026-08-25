export interface RegionConfig { id: string; name: string; center: [number, number]; zoom: number; }

export const REGIONS: RegionConfig[] = [
  { id: "laisong", name: "Laisong Reserved Forest", center: [25.852, 92.912], zoom: 13 },
  { id: "corbett", name: "Jim Corbett National Park", center: [29.452, 79.213], zoom: 12 },
  { id: "jyotikuchi", name: "Jyotikuchi Forest Reserve", center: [26.155, 91.72], zoom: 13 },
  { id: "similipal", name: "Similipal National Park", center: [21.75, 86.25], zoom: 11 },
];
