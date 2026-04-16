import React, { useState, useEffect } from 'react';

interface StatusBarProps {
  lastUpdated: Date | null;
  onRefresh: () => void;
}

// Calcula tiempo relativo legible desde una fecha pasada
function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `hace ${minutes}m`;
}

export function StatusBar({ lastUpdated, onRefresh }: StatusBarProps) {
  // Ticker para refrescar el tiempo relativo cada 5 segundos
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 11,
        color: 'var(--color-muted)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Punto verde pulsante cuando hay datos */}
        {lastUpdated && (
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: 'var(--color-ok)',
              boxShadow: '0 0 4px var(--color-ok)',
            }}
          />
        )}
        <span>{lastUpdated ? relativeTime(lastUpdated) : 'Conectando...'}</span>
      </div>

      {/* Botón de actualización manual */}
      <button
        onClick={onRefresh}
        title="Actualizar ahora"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-muted)',
          padding: '2px 4px',
          borderRadius: 3,
          fontSize: 12,
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-fg)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-muted)';
        }}
      >
        ↻
      </button>
    </div>
  );
}
