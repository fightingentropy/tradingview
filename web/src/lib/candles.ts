export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const resolutionToMs = (resolution: string): number => {
  if (resolution.endsWith("D")) {
    return parseInt(resolution, 10) * 24 * 60 * 60 * 1000;
  }
  if (resolution.endsWith("W")) {
    return parseInt(resolution, 10) * 7 * 24 * 60 * 60 * 1000;
  }
  return parseInt(resolution, 10) * 60 * 1000;
};
