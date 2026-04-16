import React from 'react';

interface UsageMeterProps {
  label: string;
  utilization: number;
  resetsAt: string | null;
}

// Devuelve el color apropiado según el nivel de uso
function getColor(utilization: number): string {
  if (utilization >= 80) return 'var(--color-error)';
  if (utilization >= 50) return 'var(--color-warn)';
  return 'var(--color-ok)';
}

// Formatea el tiempo restante hasta el reset de la ventana
function formatReset(resetsAt: string | null): string {
  if (!resetsAt) return '';

  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return 'reiniciando...';

  const totalMinutes = Math.floor(diff / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `reinicia en ${hours}h ${minutes}m`;
  return `reinicia en ${minutes}m`;
}

export function UsageMeter({ label, utilization, resetsAt }: UsageMeterProps) {
  const pct = Math.min(100, Math.max(0, utilization));
  const color = getColor(pct);
  const resetText = formatReset(resetsAt);

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Encabezado: etiqueta y porcentaje */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
        <span style={{ color: 'var(--color-fg)' }}>{label}</span>
        <span style={{ fontWeight: 600, color }}>{pct.toFixed(1)}%</span>
      </div>

      {/* Barra de progreso */}
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
            backgroundColor: color,
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* Tiempo hasta reset */}
      {resetText && (
        <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 3 }}>
          {resetText}
        </div>
      )}
    </div>
  );
}
