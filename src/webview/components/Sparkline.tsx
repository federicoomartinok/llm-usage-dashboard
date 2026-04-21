import React, { useId } from 'react';

interface SparklineProps {
  points: number[];
  color: string;
  width?: number;
  height?: number;
  className?: string;
}

// Mini chart SVG — sin recharts (overhead innecesario para 6-12 puntos)
export function Sparkline({ points, color, width = 64, height = 18, className }: SparklineProps) {
  const id = useId();

  if (points.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden="true" />;
  }

  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(1, max - min);
  const stepX = width / (points.length - 1);

  const path = points
    .map((p, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (height - ((p - min) / range) * height).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');

  const areaPath = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${id})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
