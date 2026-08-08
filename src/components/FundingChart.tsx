import {
  Canvas,
  Circle,
  Line as SkiaLine,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useHlFundingHistory } from '@/data/useHlHistory';
import {
  aggregateFundingPoints,
  formatFundingRatePercent,
  FUNDING_RESOLUTIONS,
  type AggregatedFundingPoint,
  type FundingResolution,
} from '@/lib/fundingHistory';

const RATE_UP = '#4EBC95';
const RATE_DOWN = '#F06A83';
const CUMULATIVE = '#D7DDDB';
const LEFT_GUTTER = 48;
const RIGHT_GUTTER = 48;
const TOP_GUTTER = 14;
const BOTTOM_GUTTER = 26;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface PlotGeometry {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  minTime: number;
  maxTime: number;
  minRate: number;
  maxRate: number;
  minCumulative: number;
  maxCumulative: number;
  x: (time: number) => number;
  rateY: (rate: number) => number;
  cumulativeY: (rate: number) => number;
}

interface RateSegment {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

function paddedDomain(values: number[], includeZero = true): [number, number] {
  let min = Math.min(...values, ...(includeZero ? [0] : []));
  let max = Math.max(...values, ...(includeZero ? [0] : []));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
  if (min === max) {
    const nudge = Math.max(Math.abs(min) * 0.12, 0.000001);
    min -= nudge;
    max += nudge;
  } else {
    const pad = (max - min) * 0.1;
    min -= pad;
    max += pad;
  }
  return [min, max];
}

function makeGeometry(
  points: AggregatedFundingPoint[],
  width: number,
  height: number,
): PlotGeometry | null {
  if (points.length < 2 || width <= LEFT_GUTTER + RIGHT_GUTTER || height <= 120) return null;
  const plotLeft = LEFT_GUTTER;
  const plotRight = width - RIGHT_GUTTER;
  const plotTop = TOP_GUTTER;
  const plotBottom = height - BOTTOM_GUTTER;
  const minTime = points[0].t;
  const maxTime = points.at(-1)!.t;
  const [minRate, maxRate] = paddedDomain(points.map((point) => point.rate));
  const [minCumulative, maxCumulative] = paddedDomain(
    points.map((point) => point.cumulative),
  );
  const timeSpan = maxTime - minTime || 1;
  const rateSpan = maxRate - minRate || 1;
  const cumulativeSpan = maxCumulative - minCumulative || 1;
  return {
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    minTime,
    maxTime,
    minRate,
    maxRate,
    minCumulative,
    maxCumulative,
    x: (time) => plotLeft + ((time - minTime) / timeSpan) * (plotRight - plotLeft),
    rateY: (rate) =>
      plotTop + (1 - (rate - minRate) / rateSpan) * (plotBottom - plotTop),
    cumulativeY: (rate) =>
      plotTop +
      (1 - (rate - minCumulative) / cumulativeSpan) * (plotBottom - plotTop),
  };
}

function buildRateSegments(
  points: AggregatedFundingPoint[],
  geometry: PlotGeometry,
): RateSegment[] {
  const segments: RateSegment[] = [];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    const x1 = geometry.x(previous.t);
    const y1 = geometry.rateY(previous.rate);
    const x2 = geometry.x(current.t);
    const y2 = geometry.rateY(current.rate);
    const previousPositive = previous.rate >= 0;
    const currentPositive = current.rate >= 0;
    if (previousPositive === currentPositive || previous.rate === current.rate) {
      segments.push({
        key: String(index),
        x1,
        y1,
        x2,
        y2,
        color: currentPositive ? RATE_UP : RATE_DOWN,
      });
      continue;
    }

    const crossing = Math.abs(previous.rate) / Math.abs(current.rate - previous.rate);
    const crossX = x1 + (x2 - x1) * crossing;
    const crossY = geometry.rateY(0);
    segments.push({
      key: `${index}-a`,
      x1,
      y1,
      x2: crossX,
      y2: crossY,
      color: previousPositive ? RATE_UP : RATE_DOWN,
    });
    segments.push({
      key: `${index}-b`,
      x1: crossX,
      y1: crossY,
      x2,
      y2,
      color: currentPositive ? RATE_UP : RATE_DOWN,
    });
  }
  return segments;
}

function formatAxisPercent(value: number): string {
  const percent = value * 100;
  const abs = Math.abs(percent);
  const decimals = abs >= 1 ? 1 : abs >= 0.1 ? 2 : 3;
  return `${percent.toFixed(decimals)}%`;
}

function dateLabel(timestamp: number, resolution: FundingResolution): string {
  const date = new Date(timestamp);
  if (resolution === '1h') return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function tooltipDate(timestamp: number): string {
  const date = new Date(timestamp);
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${hour}:${minute}`;
}

export function FundingChart({ coin }: { coin: string }) {
  const { data, isLoading, isError, refetch } = useHlFundingHistory(coin);
  const [resolution, setResolution] = useState<FundingResolution>('1d');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const points = useMemo(
    () => aggregateFundingPoints(data ?? [], resolution),
    [data, resolution],
  );
  const geometry = useMemo(
    () => makeGeometry(points, size.width, size.height),
    [points, size.height, size.width],
  );

  const chart = useMemo(() => {
    if (!geometry) return null;
    const cumulativeBuilder = Skia.PathBuilder.Make();
    points.forEach((point, index) => {
      const x = geometry.x(point.t);
      const y = geometry.cumulativeY(point.cumulative);
      if (index === 0) cumulativeBuilder.moveTo(x, y);
      else cumulativeBuilder.lineTo(x, y);
    });
    return {
      cumulative: cumulativeBuilder.build(),
      rateSegments: buildRateSegments(points, geometry),
    };
  }, [geometry, points]);

  const selectAt = useCallback(
    (locationX: number) => {
      if (!geometry || points.length === 0) return;
      const clamped = Math.max(geometry.plotLeft, Math.min(geometry.plotRight, locationX));
      const targetTime =
        geometry.minTime +
        ((clamped - geometry.plotLeft) / (geometry.plotRight - geometry.plotLeft)) *
          (geometry.maxTime - geometry.minTime);
      let nearest = 0;
      let distance = Infinity;
      points.forEach((point, index) => {
        const nextDistance = Math.abs(point.t - targetTime);
        if (nextDistance < distance) {
          nearest = index;
          distance = nextDistance;
        }
      });
      setSelectedIndex(nearest);
    },
    [geometry, points],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => selectAt(event.nativeEvent.locationX),
        onPanResponderMove: (event) => selectAt(event.nativeEvent.locationX),
        onPanResponderRelease: () => setSelectedIndex(null),
        onPanResponderTerminate: () => setSelectedIndex(null),
      }),
    [selectAt],
  );

  const selected =
    selectedIndex != null && selectedIndex < points.length ? points[selectedIndex] : null;
  const selectedX = selected && geometry ? geometry.x(selected.t) : 0;
  const tooltipWidth = 178;
  const tooltipLeft = geometry
    ? selectedX > geometry.width / 2
      ? Math.max(4, selectedX - tooltipWidth - 10)
      : Math.min(geometry.width - tooltipWidth - 4, selectedX + 10)
    : 0;
  const xTicks = points.length > 1 ? [points[0], points[Math.floor((points.length - 1) / 2)], points.at(-1)!] : [];

  return (
    <View style={styles.root}>
      <View style={styles.chartHead}>
        <View style={styles.legendGroup}>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: RATE_UP }]} />
            <AppText variant="caption" color={Colors.textMuted}>Funding rate</AppText>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: CUMULATIVE }]} />
            <AppText variant="caption" color={Colors.textMuted}>Cumulative</AppText>
          </View>
        </View>

        <View style={styles.resolutions}>
          {FUNDING_RESOLUTIONS.map((item) => {
            const active = item.key === resolution;
            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  setResolution(item.key);
                  setSelectedIndex(null);
                }}
                style={[styles.resolution, active && styles.resolutionActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}>
                <AppText
                  variant="caption"
                  color={active ? Colors.text : Colors.textMuted}
                  style={active && styles.resolutionLabelActive}>
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View
        style={styles.plot}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${coin} funding rate and cumulative funding chart`}
        accessibilityHint="Drag across the chart for hourly settlement details"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width !== size.width || height !== size.height) setSize({ width, height });
        }}
        {...panResponder.panHandlers}>
        {geometry && chart ? (
          <>
            <Canvas style={StyleSheet.absoluteFill}>
              {[0, 0.5, 1].map((fraction) => {
                const y =
                  geometry.plotTop + fraction * (geometry.plotBottom - geometry.plotTop);
                return (
                  <SkiaLine
                    key={fraction}
                    p1={vec(geometry.plotLeft, y)}
                    p2={vec(geometry.plotRight, y)}
                    color="rgba(255,255,255,0.075)"
                    strokeWidth={1}
                  />
                );
              })}
              <SkiaLine
                p1={vec(geometry.plotLeft, geometry.rateY(0))}
                p2={vec(geometry.plotRight, geometry.rateY(0))}
                color="rgba(255,255,255,0.22)"
                strokeWidth={1}
              />
              {chart.rateSegments.map((segment) => (
                <SkiaLine
                  key={segment.key}
                  p1={vec(segment.x1, segment.y1)}
                  p2={vec(segment.x2, segment.y2)}
                  color={segment.color}
                  strokeWidth={2.1}
                />
              ))}
              <Path
                path={chart.cumulative}
                style="stroke"
                strokeWidth={2.2}
                color={CUMULATIVE}
                strokeCap="round"
                strokeJoin="round"
              />
              {selected && selectedIndex != null ? (
                <>
                  <SkiaLine
                    p1={vec(selectedX, geometry.plotTop)}
                    p2={vec(selectedX, geometry.plotBottom)}
                    color="rgba(255,255,255,0.46)"
                    strokeWidth={1}
                  />
                  <Circle
                    cx={selectedX}
                    cy={geometry.rateY(selected.rate)}
                    r={4}
                    color={selected.rate >= 0 ? RATE_UP : RATE_DOWN}
                  />
                  <Circle
                    cx={selectedX}
                    cy={geometry.cumulativeY(selected.cumulative)}
                    r={4}
                    color={CUMULATIVE}
                  />
                </>
              ) : null}
            </Canvas>

            {[geometry.maxRate, (geometry.maxRate + geometry.minRate) / 2, geometry.minRate].map(
              (value, index) => (
                <AppText
                  key={`left-${index}`}
                  numeric
                  style={[
                    styles.axisLabel,
                    styles.leftAxis,
                    {
                      top:
                        geometry.plotTop +
                        index * ((geometry.plotBottom - geometry.plotTop) / 2) -
                        7,
                    },
                  ]}>
                  {formatAxisPercent(value)}
                </AppText>
              ),
            )}
            {[
              geometry.maxCumulative,
              (geometry.maxCumulative + geometry.minCumulative) / 2,
              geometry.minCumulative,
            ].map((value, index) => (
              <AppText
                key={`right-${index}`}
                numeric
                style={[
                  styles.axisLabel,
                  styles.rightAxis,
                  {
                    top:
                      geometry.plotTop +
                      index * ((geometry.plotBottom - geometry.plotTop) / 2) -
                      7,
                  },
                ]}>
                {formatAxisPercent(value)}
              </AppText>
            ))}
            {xTicks.map((point, index) => (
              <AppText
                key={`${point.t}-${index}`}
                numeric
                style={[
                  styles.xAxis,
                  {
                    left: Math.max(
                      geometry.plotLeft - 18,
                      Math.min(geometry.plotRight - 38, geometry.x(point.t) - 24),
                    ),
                  },
                ]}>
                {dateLabel(point.t, resolution)}
              </AppText>
            ))}

            {selected ? (
              <View style={[styles.tooltip, { left: tooltipLeft, width: tooltipWidth }]}>
                <AppText variant="caption" color={Colors.text}>{tooltipDate(selected.t)}</AppText>
                <View style={styles.tooltipRow}>
                  <AppText variant="caption" muted>Funding rate</AppText>
                  <AppText
                    variant="caption"
                    numeric
                    color={selected.rate >= 0 ? RATE_UP : RATE_DOWN}>
                    {formatFundingRatePercent(selected.rate)}
                  </AppText>
                </View>
                <View style={styles.tooltipRow}>
                  <AppText variant="caption" muted>Cumulative</AppText>
                  <AppText variant="caption" numeric color={CUMULATIVE}>
                    {formatFundingRatePercent(selected.cumulative)}
                  </AppText>
                </View>
              </View>
            ) : null}
          </>
        ) : isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : isError ? (
          <View style={styles.center}>
            <AppText variant="caption" muted>Couldn’t load funding history</AppText>
            <Pressable onPress={() => refetch()} hitSlop={8}>
              <AppText variant="label" color={Colors.accent}>Retry</AppText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.center}>
            <AppText variant="caption" muted>No funding history for this market</AppText>
          </View>
        )}
      </View>

      <AppText variant="caption" color={Colors.textFaint} style={styles.hint}>
        Drag across the chart for hourly settlement details
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: Spacing.sm, paddingTop: Spacing.sm },
  chartHead: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  legendGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendLine: { width: 13, height: 2, borderRadius: 1 },
  resolutions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  resolution: {
    minWidth: 34,
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  resolutionActive: { backgroundColor: 'rgba(255,255,255,0.10)' },
  resolutionLabelActive: { fontWeight: '700' },
  plot: {
    flex: 1,
    minHeight: 220,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: 'rgba(9,17,21,0.72)',
  },
  axisLabel: {
    position: 'absolute',
    width: 46,
    color: Colors.textFaint,
    fontSize: 9,
    lineHeight: 14,
  },
  leftAxis: { left: 1, textAlign: 'right', paddingRight: 5 },
  rightAxis: { right: 1, paddingLeft: 5 },
  xAxis: {
    position: 'absolute',
    bottom: 4,
    width: 52,
    textAlign: 'center',
    color: Colors.textFaint,
    fontSize: 9,
  },
  tooltip: {
    position: 'absolute',
    top: 18,
    padding: 10,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(29,37,43,0.96)',
    gap: 5,
  },
  tooltipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  hint: { textAlign: 'center', paddingTop: 6, paddingBottom: 2 },
});
