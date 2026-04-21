import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
} from 'recharts';
import type { UsageSnapshot } from '../../extension/providers/types';

interface MiniTrendChartProps {
  snapshots: UsageSnapshot[];
}

interface ChartPoint {
  time: string;
  session: number;
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number }> }) {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="glass-card tabular"
      style={{
        padding: '4px 9px',
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--color-fg)',
        borderRadius: 6,
      }}
    >
      {payload[0].value.toFixed(1)}%
    </div>
  );
}

export function MiniTrendChart({ snapshots }: MiniTrendChartProps) {
  if (snapshots.length < 2) return null;

  const data: ChartPoint[] = snapshots.map((s) => ({
    time: formatTime(s.timestamp),
    session: s.fiveHour.utilization,
  }));

  return (
    <div className="glass-card" style={{ padding: '8px 10px 4px' }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--color-muted-dim)',
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        Tendencia sesión
      </div>
      <ResponsiveContainer width="100%" height={70}>
        <AreaChart data={data} margin={{ top: 2, right: 2, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sessionGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <XAxis dataKey="time" hide />
          <Tooltip content={<CustomTooltip />} />

          <Area
            type="monotone"
            dataKey="session"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            fill="url(#sessionGradient)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
