import React from 'react';

interface CreditsMeterProps {
  usedCredits: number;
  monthlyLimit: number;
  isEnabled: boolean;
  burnUsdPerDay?: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function CreditsMeter({ usedCredits, monthlyLimit, isEnabled, burnUsdPerDay }: CreditsMeterProps) {
  if (!isEnabled) return null;

  const pct = monthlyLimit > 0 ? Math.min(100, (usedCredits / monthlyLimit) * 100) : 0;
  const isHot = pct >= 80;
  const barColor = isHot ? 'var(--color-warn-strong)' : 'var(--color-ok)';

  return (
    <div className="glass-card" style={{ padding: '10px 12px', marginBottom: 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600 }}>
          Extra Usage
        </span>
        <span className="tabular" style={{ fontSize: 11, color: 'var(--color-muted)' }}>
          {formatCurrency(usedCredits)} / {formatCurrency(monthlyLimit)}
        </span>
      </div>

      <div
        style={{
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
            background: `linear-gradient(90deg, ${barColor}aa, ${barColor})`,
            borderRadius: 3,
            transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: `0 0 6px ${barColor}66`,
          }}
        />
      </div>

      {typeof burnUsdPerDay === 'number' && burnUsdPerDay !== 0 && (
        <div
          className="tabular"
          style={{
            fontSize: 9,
            color: 'var(--color-muted-dim)',
            marginTop: 4,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{burnUsdPerDay >= 0 ? '+' : ''}{formatCurrency(burnUsdPerDay)}/día</span>
          <span>{pct.toFixed(1)}% del mes</span>
        </div>
      )}
    </div>
  );
}
