import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { formatCompact, usd } from '@/lib/format';
import type { HlPortfolioPoint } from '@/lib/hyperliquid/info';

export interface EquityCurveProps { points: HlPortfolioPoint[]; color: string; height?: number; hidden?: boolean; }
export function portfolioStamp(t: number): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(t));
}

export function EquityCurve({ points, color, height = 208, hidden = false }: EquityCurveProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    let min = Math.min(...points.map((point) => point.v));
    let max = Math.max(...points.map((point) => point.v));
    const pad = (max - min) * 0.07 || Math.max(1, Math.abs(min) * 0.01);
    min -= pad; max += pad;
    const start = points[0].t;
    const span = points[points.length - 1].t - start || 1;
    const x = (t: number) => 8 + ((t - start) / span) * 984;
    const y = (v: number) => 8 + (1 - (v - min) / (max - min)) * (height - 16);
    const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.t).toFixed(2)},${y(point.v).toFixed(2)}`).join(' ');
    return { min, max, x, y, line };
  }, [height, points]);
  const index = selected == null ? null : Math.min(selected, points.length - 1);
  const point = index == null ? null : points[index];
  const inspect = (event: PointerEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const target = Math.max(0, Math.min(1000, ((event.clientX - bounds.left) / bounds.width) * 1000));
    let closest = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(geometry.x(points[i].t) - target) < Math.abs(geometry.x(points[closest].t) - target)) closest = i;
    }
    setSelected(closest);
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') setSelected(null);
    else setSelected(Math.max(0, Math.min(points.length - 1, (index ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))));
  };
  const tick = (value: number) => hidden ? '••••' : `${value < 0 ? '−' : ''}$${formatCompact(Math.abs(value))}`;
  if (!geometry) return null;

  return (
    <div className="account-curve">
      <div className="account-curve-readout" aria-live="polite">{point ? <><span>{portfolioStamp(point.t)}</span><strong>{hidden ? '••••' : `${point.v < 0 ? '−' : ''}${usd(point.v)}`}</strong></> : <span>Hover or use arrow keys to inspect</span>}</div>
      <div className="account-curve-plot" style={{ height }}>
        <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" role="img" aria-label="Portfolio history. Use the arrow keys to inspect values." tabIndex={0} onPointerMove={inspect} onPointerLeave={() => setSelected(null)} onKeyDown={onKeyDown} onBlur={() => setSelected(null)}>
          {[8, height / 2, height - 8].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} className="account-curve-grid" />)}
          <path d={geometry.line} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          {point ? <><line x1={geometry.x(point.t)} x2={geometry.x(point.t)} y1="0" y2={height} className="account-curve-cursor" /><circle cx={geometry.x(point.t)} cy={geometry.y(point.v)} r="3" fill={color} /></> : null}
        </svg>
        <div className="account-curve-axis" aria-hidden="true"><span>{tick(geometry.max)}</span><span>{tick((geometry.max + geometry.min) / 2)}</span><span>{tick(geometry.min)}</span></div>
      </div>
      <div className="account-curve-dates"><span>{portfolioStamp(points[0].t)}</span><span>{portfolioStamp(points[points.length - 1].t)}</span></div>
    </div>
  );
}
