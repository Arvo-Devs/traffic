'use client';

// Vendored from betterfanslink components/ui/charts.tsx (main d4138f9): AreaChart and Breakdown, drawn in chart-1 with border grid lines, without Sparkline and RequestBars.
import { useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from './cn';

type Point = { label: string; value: number };

/**
 * The axis top for counts: a round number whose half, the middle label, is a
 * whole number too, so a chart of a few requests never reads "0.5".
 */
export function niceMax(max: number) {
  if (max <= 2) return 2;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const steps = pow >= 10 ? [1, 2, 4, 5, 6, 8, 10] : [2, 4, 6, 8, 10];
  return (steps.find((step) => n <= step) ?? 10) * pow;
}

/** Index of the point under the pointer for a chart that spans the element. */
function useHoverIndex(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const onPointerMove = (e: ReactPointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || count === 0) return;
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    setIndex(count === 1 ? 0 : Math.round((x / rect.width) * (count - 1)));
  };
  return { ref, index, setIndex, onPointerMove, onPointerLeave: () => setIndex(null) };
}

function Tooltip({ x, children }: { x: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-input bg-muted px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
      style={{ left: `clamp(56px, ${x * 100}%, calc(100% - 56px))` }}
    >
      {children}
    </div>
  );
}

/**
 * An area chart with a hover readout. `format` renders a value, `detail`
 * adds a second line to the readout for a point.
 */
export function AreaChart({
  points,
  format,
  detail,
  height = 200,
  label,
  className,
}: {
  points: Point[];
  format: (v: number) => string;
  detail?: (index: number) => ReactNode;
  height?: number;
  label: string;
  className?: string;
}) {
  const gid = useId();
  const hover = useHoverIndex(points.length);
  const max = useMemo(() => niceMax(Math.max(0, ...points.map((p) => p.value))), [points]);
  const w = 100;
  const h = 100;
  const xy = points.map((p, i) => [points.length === 1 ? w / 2 : (i / (points.length - 1)) * w, h - (p.value / max) * h] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(3)},${y.toFixed(3)}`).join('');
  const active = hover.index !== null ? points[hover.index] : null;
  const activePoint = hover.index !== null ? xy[hover.index] : undefined;
  const activeX = activePoint ? activePoint[0] / w : 0;
  const total = points.reduce((s, p) => s + p.value, 0);

  return (
    <figure className={cn('min-w-0', className)}>
      <figcaption className="sr-only">
        {label}: {points.length} points, total {format(total)}, highest {format(Math.max(0, ...points.map((p) => p.value)))}.
      </figcaption>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between py-0 text-right text-[11px] text-muted-foreground/80 tabular-nums" style={{ height }} aria-hidden>
          <span>{format(max)}</span>
          <span>{format(max / 2)}</span>
          <span>{format(0)}</span>
        </div>
        <div
          ref={hover.ref}
          className="relative min-w-0 flex-1 touch-pan-y"
          style={{ height }}
          onPointerMove={hover.onPointerMove}
          onPointerDown={hover.onPointerMove}
          onPointerLeave={hover.onPointerLeave}
          aria-hidden
        >
          {/* The line and its fill are currentColor, so chart-1 colors them without reading a CSS variable here. */}
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible text-chart-1">
            <defs>
              <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((t) => (
              <line key={t} x1="0" x2={w} y1={h * t} y2={h * t} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {points.length > 1 ? <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${gid})`} /> : null}
            <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {activePoint ? (
              <line x1={activePoint[0]} x2={activePoint[0]} y1="0" y2={h} className="stroke-input" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ) : null}
          </svg>
          {activePoint ? (
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-chart-1"
              style={{ left: `${activeX * 100}%`, top: `${(activePoint[1] / h) * 100}%` }}
            />
          ) : null}
          {active && hover.index !== null ? (
            <Tooltip x={activeX}>
              <p className="text-muted-foreground/80">{active.label}</p>
              <p className="font-semibold text-foreground tabular-nums">{format(active.value)}</p>
              {detail ? <div className="text-muted-foreground">{detail(hover.index)}</div> : null}
            </Tooltip>
          ) : null}
        </div>
      </div>
      <XAxis labels={points.map((p) => p.label)} />
    </figure>
  );
}

function XAxis({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  const picks = labels.length <= 2 ? labels.map((_, i) => i) : [0, Math.floor((labels.length - 1) / 2), labels.length - 1];
  return (
    <div className="mt-2 flex justify-between pl-10 text-[11px] text-muted-foreground/80" aria-hidden>
      {picks.map((i) => (
        <span key={i}>{labels[i]}</span>
      ))}
    </div>
  );
}

/** Horizontal share bars, for spend by type and similar breakdowns. */
export function Breakdown({
  items,
  format,
  className,
}: {
  items: { label: ReactNode; value: number; key: string }[];
  format: (v: number) => string;
  className?: string;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className={cn('space-y-3', className)}>
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">{item.label}</span>
            <span className="shrink-0 font-medium text-foreground tabular-nums">
              {format(item.value)}
              <span className="ml-2 text-xs font-normal text-muted-foreground/80">{total ? Math.round((item.value / total) * 100) : 0}%</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background">
            <div className="h-full rounded-full bg-chart-1" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
