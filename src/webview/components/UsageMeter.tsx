import React from 'react';
import { Sparkline } from './Sparkline';
import type { Delta, Projection } from '../../extension/services/metrics-calculator';
import { formatDurationCompact } from '../../extension/services/metrics-calculator';

interface UsageMeterProps {
  label: string;
  utilization: number;
  resetsAt: string | null;
  sparkline?: number[];
  delta?: Delta;
  projection?: Projection | null;
  accentColor?: string;
}

function getColor(utilization: number): string {
  if (utilization >= 90) return 'var(--color-error)';
  if (utilization >= 70) return 'var(--color-warn-strong)';
  if (utilization >= 40) return 'var(--color-warn)';
  return 'var(--color-ok)';
}

function formatReset(resetsAt: string | null): string {
  if (!resetsAt) return '';
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return 'reiniciando';
  return `reset ${formatDurationCompact(diff)}`;
}

function DeltaPill({ delta }: { delta: Delta }) {
  if (delta.deltaSign === 'flat') return null;
  const isUp = delta.deltaSign === 'up';
  const bg = isUp ? 'rgba(243, 139, 168, 0.15)' : 'rgba(166, 227, 161, 0.15)';
  const color = isUp ? 'var(--color-error)' : 'var(--color-ok)';
  return (
    <span
      className="tabular"
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: '1px 5px',
        borderRadius: 5,
        background: bg,
        color,
      }}
    >
      {isUp ? '▲' : '▼'} {Math.abs(delta.deltaPct).toFixed(1)}%
    </span>
  );
}

export function UsageMeter({
  label,
  utilization,
  resetsAt,
  sparkline,
  delta,
  projection,
  accentColor,
}: UsageMeterProps) {
  const pct = Math.min(100, Math.max(0, utilization));
  const color = accentColor ?? getColor(pct);
  const resetText = formatReset(resetsAt);

  return (
    <div
      className="glass-card"
      style={{
        padding: '10px 12px',
        marginBottom: 8,
      }}
    >
      {/* Header: label + delta + % */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--color-muted)',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </span>
          {delta && <DeltaPill delta={delta} />}
        </div>
        <span
          className="tabular"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color,
            letterSpacing: '-0.01em',
          }}
        >
          {pct.toFixed(1)}%
        </span>
      </div>

      {/* Barra + sparkline en línea */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            flex: 1,
            height: 5,
            borderRadius: 3,
            backgroundColor: 'rgba(69, 71, 90, 0.5)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${color}aa, ${color})`,
              borderRadius: 3,
              transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: `0 0 6px ${color}66`,
            }}
          />
        </div>
        {sparkline && sparkline.length >= 2 && (
          <Sparkline points={sparkline} color={color} width={48} height={14} />
        )}
      </div>

      {/* Footer: reset + projection */}
      {(resetText || projection) && (
        <div
          className="tabular"
          style={{
            fontSize: 9,
            color: 'var(--color-muted-dim)',
            marginTop: 4,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <span>{resetText}</span>
          {projection?.exhaustsInMs && projection.beforeReset && (
            <span style={{ color: 'var(--color-error)', fontWeight: 600 }}>
              agota en {formatDurationCompact(projection.exhaustsInMs)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
