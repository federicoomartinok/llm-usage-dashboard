import React from 'react';

interface CreditsMeterProps {
  usedCredits: number;
  monthlyLimit: number;
  isEnabled: boolean;
}

// Formatea un número como moneda USD sin decimales
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function CreditsMeter({ usedCredits, monthlyLimit, isEnabled }: CreditsMeterProps) {
  if (!isEnabled) return null;

  const pct = monthlyLimit > 0 ? Math.min(100, (usedCredits / monthlyLimit) * 100) : 0;

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
        <span style={{ color: 'var(--color-fg)' }}>Uso extra</span>
        <span style={{ color: 'var(--color-muted)' }}>
          {formatCurrency(usedCredits)} / {formatCurrency(monthlyLimit)}
        </span>
      </div>

      {/* Barra siempre verde para créditos (indica consumo de presupuesto) */}
      <div
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: 'var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            backgroundColor: 'var(--color-ok)',
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
