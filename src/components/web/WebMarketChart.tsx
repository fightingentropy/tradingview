import { useId, useMemo, useState, type PointerEvent } from 'react';

import type { Candle } from '@/domain/types';
import { formatCandleStamp, formatPrice } from '@/lib/format';

const WIDTH = 1000;
const HEIGHT = 360;
const PAD_X = 16;
const PAD_Y = 22;

type Point = { x: number; y: number; candle: Candle };

export function WebMarketChart({
  candles,
  decimals,
  loading,
}: {
  candles: Candle[];
  decimals: number;
  loading?: boolean;
}) {
  const gradientId = useId().replace(/:/g, '');
  const [hovered, setHovered] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const shown = candles.slice(-140);
    if (shown.length < 2) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const candle of shown) {
      min = Math.min(min, candle.l);
      max = Math.max(max, candle.h);
    }
    const span = max - min || Math.abs(max) * 0.01 || 1;
    min -= span * 0.08;
    max += span * 0.08;
    const innerW = WIDTH - PAD_X * 2;
    const innerH = HEIGHT - PAD_Y * 2;
    const points: Point[] = shown.map((candle, index) => ({
      x: PAD_X + (index / (shown.length - 1)) * innerW,
      y: PAD_Y + ((max - candle.c) / (max - min)) * innerH,
      candle,
    }));
    const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${HEIGHT - PAD_Y} L ${points[0].x.toFixed(2)} ${HEIGHT - PAD_Y} Z`;
    const open = shown[0].c;
    const close = shown[shown.length - 1].c;
    return { points, line, area, min, max, positive: close >= open };
  }, [candles]);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHovered(Math.round(relative * (geometry.points.length - 1)));
  };

  if (!geometry) {
    return (
      <div className={`web-chart-empty${loading ? ' is-loading' : ''}`}>
        <span />
        <p>{loading ? 'Loading live chart' : 'Chart data is unavailable'}</p>
      </div>
    );
  }

  const active = hovered == null ? geometry.points[geometry.points.length - 1] : geometry.points[hovered];
  const stroke = geometry.positive ? '#62e6b5' : '#ff7388';

  return (
    <div className="web-chart-wrap">
      <div className="web-chart-hover-readout" aria-live="polite">
        <span>{formatCandleStamp(active.candle.t, 'time')}</span>
        <strong>{formatPrice(active.candle.c, decimals)}</strong>
      </div>
      <svg
        className="web-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Live market price chart"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.24" />
            <stop offset="92%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.18, 0.42, 0.66, 0.9].map((ratio) => (
          <line
            key={ratio}
            x1="0"
            x2={WIDTH}
            y1={HEIGHT * ratio}
            y2={HEIGHT * ratio}
            className="web-chart-grid"
          />
        ))}
        <path d={geometry.area} fill={`url(#${gradientId})`} />
        <path d={geometry.line} fill="none" stroke={stroke} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
        {hovered != null ? (
          <>
            <line
              x1={active.x}
              x2={active.x}
              y1="0"
              y2={HEIGHT}
              className="web-chart-crosshair"
            />
            <circle cx={active.x} cy={active.y} r="5" fill="#090c10" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
      </svg>
      <div className="web-chart-axis" aria-hidden="true">
        <span>{formatPrice(geometry.max, decimals)}</span>
        <span>{formatPrice((geometry.max + geometry.min) / 2, decimals)}</span>
        <span>{formatPrice(geometry.min, decimals)}</span>
      </div>
    </div>
  );
}
