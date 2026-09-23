export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const CHART_RESOLUTIONS = ["1", "5", "15", "60", "240", "1D", "1W"] as const;
export type ChartResolution = typeof CHART_RESOLUTIONS[number];
export const RESOLUTION_LABELS: Record<ChartResolution, string> = {
  "1": "1m", "5": "5m", "15": "15m", "60": "1H", "240": "4H", "1D": "1D", "1W": "1W",
};

export const resolutionToMs = (resolution: string): number => {
  if (resolution.endsWith("D")) {
    return parseInt(resolution, 10) * 24 * 60 * 60 * 1000;
  }
  if (resolution.endsWith("W")) {
    return parseInt(resolution, 10) * 7 * 24 * 60 * 60 * 1000;
  }
  return parseInt(resolution, 10) * 60 * 1000;
};
