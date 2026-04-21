import React, { useState, useEffect } from 'react';

interface StatusBarProps {
  lastUpdated: Date | null;
  onRefresh: () => void;
}

function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours}h`;
}

export function StatusBar({ lastUpdated, onRefresh }: StatusBarProps) {
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
        fontSize: 10,
        color: 'var(--color-muted-dim)',
        letterSpacing: '0.02em',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {lastUpdated && (
          <span
            className="animate-pulse-soft"
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: 'var(--color-ok)',
              boxShadow: '0 0 6px var(--color-ok)',
            }}
          />
        )}
        <span>{lastUpdated ? relativeTime(lastUpdated) : 'Conectando...'}</span>
      </div>

      <button
        onClick={onRefresh}
        title="Actualizar ahora"
        style={{
          background: 'rgba(69, 71, 90, 0.4)',
          border: '1px solid rgba(205, 214, 244, 0.08)',
          cursor: 'pointer',
          color: 'var(--color-muted)',
          padding: '3px 8px',
          borderRadius: 6,
          fontSize: 11,
          lineHeight: 1,
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(137, 180, 250, 0.4)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-muted)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(205, 214, 244, 0.08)';
        }}
      >
        ↻
      </button>
    </div>
  );
}
