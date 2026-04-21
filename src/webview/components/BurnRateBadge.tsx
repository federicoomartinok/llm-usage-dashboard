import React from 'react';
import type { BurnRate, Projection } from '../../extension/services/metrics-calculator';
import { formatDurationCompact } from '../../extension/services/metrics-calculator';

interface BurnRateBadgeProps {
  burn: BurnRate;
  projection: Projection | null;
}

// Pill compacta con tasa de consumo + proyección de agotamiento
export function BurnRateBadge({ burn, projection }: BurnRateBadgeProps) {
  if (burn.samplesUsed < 2) return null;

  const sev = projection?.severity ?? 'ok';
  const color =
    sev === 'critical'
      ? 'var(--color-error)'
      : sev === 'warn'
        ? 'var(--color-warn-strong)'
        : 'var(--color-ok)';

  const rate = `${burn.ratePctPerHour >= 0 ? '+' : ''}${burn.ratePctPerHour.toFixed(2)}%/h`;
  const projText =
    projection?.exhaustsInMs && projection.beforeReset
      ? `agota en ${formatDurationCompact(projection.exhaustsInMs)}`
      : burn.trend === 'falling'
        ? 'reseteando'
        : 'sin riesgo';

  return (
    <div
      className="glass-card tabular"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderColor: `${color}55`,
      }}
    >
      <span
        style={{
          fontSize: 14,
          filter: `drop-shadow(0 0 4px ${color}88)`,
        }}
      >
        🔥
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '-0.01em' }}>
          {rate}
        </span>
        <span style={{ fontSize: 9, color: 'var(--color-muted-dim)' }}>{projText}</span>
      </div>
    </div>
  );
}
