import { useMemo, useState, type PointerEvent } from 'react';

import type { Candle } from '@/domain/types';
import { formatCandleStamp, formatPrice } from '@/lib/format';
import { useChartSettings } from '@/store/chartSettings';

const WIDTH = 1000;
const HEIGHT = 390;
const PAD_X = 10;
const PAD_Y = 24;

type Bar = {
  candle: Candle;
  x: number;
  highY: number;
  lowY: number;
  openY: number;
  closeY: number;
  volumeHeight: number;
};

export function WebMarketChart({
  candles,
  decimals,
  loading,
}: {
  candles: Candle[];
  decimals: number;
  loading?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const volume = useChartSettings((state) => state.volume);

  const geometry = useMemo(() => {
    const shown = candles.slice(-96);
    if (shown.length < 2) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const candle of shown) {
      min = Math.min(min, candle.l);
      max = Math.max(max, candle.h);
    }
    const span = max - min || Math.abs(max) * 0.01 || 1;
    min -= span * 0.05;
    max += span * 0.05;

    const innerWidth = WIDTH - PAD_X * 2;
    const innerHeight = HEIGHT - PAD_Y * 2;
    const step = innerWidth / shown.length;
    const candleWidth = Math.max(2.2, Math.min(8, step * 0.68));
    const yFor = (value: number) => PAD_Y + ((max - value) / (max - min)) * innerHeight;
    const maxVolume = Math.max(1, ...shown.map((candle) => candle.v));
    const bars: Bar[] = shown.map((candle, index) => ({
      candle,
      x: PAD_X + step * index + step / 2,
      highY: yFor(candle.h),
      lowY: yFor(candle.l),
      openY: yFor(candle.o),
      closeY: yFor(candle.c),
      volumeHeight: Math.max(1, (candle.v / maxVolume) * (HEIGHT * 0.14)),
    }));

    let rollingClose = 0;
    const maPoints: string[] = [];
    for (let index = 0; index < shown.length; index += 1) {
      rollingClose += shown[index].c;
      if (index >= 20) rollingClose -= shown[index - 20].c;
      if (index >= 19) {
        const prefix = maPoints.length ? 'L' : 'M';
        maPoints.push(`${prefix}${bars[index].x.toFixed(2)},${yFor(rollingClose / 20).toFixed(2)}`);
      }
    }

    return { bars, candleWidth, min, max, lastY: bars[bars.length - 1].closeY, maPath: maPoints.join(' ') };
  }, [candles]);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHovered(Math.min(geometry.bars.length - 1, Math.floor(relative * geometry.bars.length)));
  };

  if (!geometry) {
    return (
      <div className={`web-chart-empty${loading ? ' is-loading' : ''}`}>
        <span />
        <p>{loading ? 'Loading live chart' : 'Chart data is unavailable'}</p>
      </div>
    );
  }

  const active = geometry.bars[hovered == null ? geometry.bars.length - 1 : Math.min(hovered, geometry.bars.length - 1)];
  const activeColor = active.candle.c >= active.candle.o ? 'var(--web-up)' : 'var(--web-down)';

  return (
    <div className="web-chart-wrap">
      <div className="web-chart-hover-readout" aria-live="polite">
        <strong>{formatCandleStamp(active.candle.t, 'time')}</strong>
        <span>O <b>{formatPrice(active.candle.o, decimals)}</b></span>
        <span>H <b>{formatPrice(active.candle.h, decimals)}</b></span>
        <span>L <b>{formatPrice(active.candle.l, decimals)}</b></span>
        <span>C <b className={active.candle.c >= active.candle.o ? 'is-up' : 'is-down'}>{formatPrice(active.candle.c, decimals)}</b></span>
      </div>
      <svg
        className="web-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Live candlestick market chart"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}>
        {[0.2, 0.4, 0.6, 0.8].map((ratio) => (
          <line key={`h-${ratio}`} x1="0" x2={WIDTH} y1={HEIGHT * ratio} y2={HEIGHT * ratio} className="web-chart-grid" />
        ))}
        {[0.2, 0.4, 0.6, 0.8].map((ratio) => (
          <line key={`v-${ratio}`} x1={WIDTH * ratio} x2={WIDTH * ratio} y1="0" y2={HEIGHT} className="web-chart-grid" />
        ))}
        {volume ? geometry.bars.map((bar, index) => {
          const color = bar.candle.c >= bar.candle.o ? 'var(--web-up)' : 'var(--web-down)';
          return (
            <rect
              className="web-chart-volume"
              fill={color}
              height={bar.volumeHeight}
              key={`volume-${bar.candle.t}-${index}`}
              width={Math.max(2, geometry.candleWidth * 0.9)}
              x={bar.x - (geometry.candleWidth * 0.9) / 2}
              y={HEIGHT - bar.volumeHeight}
            />
          );
        }) : null}
        {geometry.bars.map((bar, index) => {
          const color = bar.candle.c >= bar.candle.o ? 'var(--web-up)' : 'var(--web-down)';
          const top = Math.min(bar.openY, bar.closeY);
          const height = Math.max(1.5, Math.abs(bar.closeY - bar.openY));
          return (
            <g key={`${bar.candle.t}-${index}`} opacity={hovered == null || hovered === index ? 1 : 0.72}>
              <line x1={bar.x} x2={bar.x} y1={bar.highY} y2={bar.lowY} stroke={color} className="web-chart-wick" />
              <rect x={bar.x - geometry.candleWidth / 2} y={top} width={geometry.candleWidth} height={height} fill={color} rx="0.6" />
            </g>
          );
        })}
        {geometry.maPath ? <path d={geometry.maPath} className="web-chart-ma" /> : null}
        <line x1="0" x2={WIDTH} y1={geometry.lastY} y2={geometry.lastY} className="web-chart-last-line" />
        {hovered != null ? (
          <>
            <line x1={active.x} x2={active.x} y1="0" y2={HEIGHT} className="web-chart-crosshair" />
            <line x1="0" x2={WIDTH} y1={active.closeY} y2={active.closeY} className="web-chart-crosshair" />
            <circle cx={active.x} cy={active.closeY} r="4" fill="var(--web-bg)" stroke={activeColor} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
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
