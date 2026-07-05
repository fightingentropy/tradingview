import { Canvas, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';

import type { HlPortfolioPoint } from '@/lib/hyperliquid/info';

interface Props {
  points: HlPortfolioPoint[];
  /** Line + fill color (e.g. up/down green/red). Must be a 6-digit hex. */
  color: string;
  height?: number;
}

/**
 * A lightweight portfolio sparkline: a Skia line over the value series with a soft
 * gradient fill beneath it. Width is measured from layout (so it fits any container);
 * the path is rebuilt only when the points, width, or height change.
 */
export function EquityCurve({ points, color, height = 96 }: Props) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const paths = useMemo(() => {
    if (width <= 0 || points.length < 2) return null;
    const pad = 6;
    const ys = points.map((p) => p.v);
    const xs = points.map((p) => p.t);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    if (maxY === minY) {
      // Flat series (e.g. an idle account over 1D) — nudge the range so it renders a
      // centered flat line instead of dividing by a zero span.
      maxY += 1;
      minY -= 1;
    }
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY;
    const px = (t: number) => ((t - minX) / spanX) * width;
    const py = (v: number) => pad + (1 - (v - minY) / spanY) * (height - pad * 2);

    let d = `M ${px(xs[0])} ${py(ys[0])}`;
    for (let i = 1; i < points.length; i++) d += ` L ${px(xs[i])} ${py(ys[i])}`;
    const areaD = `${d} L ${px(xs[xs.length - 1])} ${height} L ${px(xs[0])} ${height} Z`;
    return { line: Skia.Path.MakeFromSVGString(d), area: Skia.Path.MakeFromSVGString(areaD) };
  }, [points, width, height]);

  return (
    <View onLayout={onLayout} style={{ height }}>
      {paths?.line && paths.area ? (
        <Canvas style={{ width, height }}>
          <Path path={paths.area}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, height)}
              colors={[`${color}40`, `${color}00`]}
            />
          </Path>
          <Path
            path={paths.line}
            style="stroke"
            strokeWidth={2}
            color={color}
            strokeJoin="round"
            strokeCap="round"
          />
        </Canvas>
      ) : null}
    </View>
  );
}
