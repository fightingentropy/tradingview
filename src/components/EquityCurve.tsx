import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Colors } from '@/constants/theme';
import { formatCompact, usd } from '@/lib/format';
import type { HlPortfolioPoint } from '@/lib/hyperliquid/info';

export interface EquityCurveProps { points: HlPortfolioPoint[]; color: string; height?: number; hidden?: boolean; }
export function portfolioStamp(t: number): string {
  const date = new Date(t);
  return `${date.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()]}`;
}
export function EquityCurve({ points, color, height = 160, hidden = false }: EquityCurveProps) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const plotWidth = Math.max(0, width - 58);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const geometry = useMemo(() => {
    if (plotWidth <= 0 || points.length < 2) return null;
    let min = Infinity; let max = -Infinity;
    for (const point of points) { min = Math.min(min, point.v); max = Math.max(max, point.v); }
    if (min === max) { const pad = Math.max(1, Math.abs(min) * 0.01); min -= pad; max += pad; }
    const start = points[0].t; const span = points[points.length - 1].t - start || 1;
    const x = (t: number) => 4 + ((t - start) / span) * (plotWidth - 8);
    const y = (v: number) => 8 + (1 - (v - min) / (max - min)) * (height - 16);
    const path = Skia.Path.Make();
    points.forEach((point, index) => index ? path.lineTo(x(point.t), y(point.v)) : path.moveTo(x(point.t), y(point.v)));
    const grid = Skia.Path.Make();
    [8, height / 2, height - 8].forEach((position) => { grid.moveTo(0, position); grid.lineTo(plotWidth, position); });
    return { path, grid, min, max, x };
  }, [height, plotWidth, points]);
  const point = selected == null ? null : points[selected];
  const inspect = (x: number) => {
    if (!geometry || !points.length) return;
    let best = 0; let distance = Infinity;
    points.forEach((candidate, index) => { const next = Math.abs(geometry.x(candidate.t) - x); if (next < distance) { best = index; distance = next; } });
    setSelected(best);
  };
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const shortWindow = points.length >= 2 && points[points.length - 1].t - points[0].t <= 2 * 86_400_000;
  const axisLabel = (t: number) => shortWindow ? time(t) : portfolioStamp(t);
  const tick = (value: number) => hidden ? '••••' : `${value < 0 ? '−' : ''}$${formatCompact(Math.abs(value))}`;
  return <View onLayout={onLayout}>
    <View style={styles.inspect}><AppText variant="caption" color={Colors.textMuted} numeric>{point ? `${portfolioStamp(point.t)} ${time(point.t)} · ${hidden ? '••••' : `${point.v < 0 ? '−' : ''}${usd(point.v)}`}` : 'Drag to inspect'}</AppText></View>
    <View style={{ height }} onTouchStart={(event) => inspect(event.nativeEvent.locationX)} onTouchMove={(event) => inspect(event.nativeEvent.locationX)} onTouchEnd={() => setSelected(null)} onTouchCancel={() => setSelected(null)}>
      {geometry ? <><Canvas style={{ width: plotWidth, height }}><Path path={geometry.grid} style="stroke" strokeWidth={0.5} color={Colors.border} /><Path path={geometry.path} style="stroke" strokeWidth={1.8} color={color} strokeJoin="round" strokeCap="round" /></Canvas>
        {[geometry.max, (geometry.max + geometry.min) / 2, geometry.min].map((value, index) => <AppText key={index} variant="caption" numeric color={Colors.textFaint} style={[styles.tick, { top: index * (height - 16) / 2 }]}>{tick(value)}</AppText>)}
        {point ? <View pointerEvents="none" style={[styles.cursor, { left: geometry.x(point.t), height }]} /> : null}</> : null}
    </View>
    <View style={[styles.dates, { paddingRight: 58 }]}><AppText variant="caption" color={Colors.textFaint}>{points[0] ? axisLabel(points[0].t) : ''}</AppText><AppText variant="caption" color={Colors.textFaint}>{points.at(-1) ? axisLabel(points.at(-1)!.t) : ''}</AppText></View>
  </View>;
}
const styles = StyleSheet.create({
  inspect: { height: 24, justifyContent: 'center' }, tick: { position: 'absolute', right: 0, width: 54, textAlign: 'right', fontSize: 10 },
  cursor: { position: 'absolute', top: 0, width: 1, backgroundColor: Colors.textMuted }, dates: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
});
