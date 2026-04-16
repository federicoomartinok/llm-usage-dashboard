import React from 'react';
import { useExtensionMessage } from './hooks/useExtensionMessage';
import { UsageMeter } from './components/UsageMeter';
import { CreditsMeter } from './components/CreditsMeter';
import { MiniTrendChart } from './components/MiniTrendChart';
import { AccountSummary } from './components/AccountSummary';
import { StatusBar } from './components/StatusBar';

// Separador visual entre secciones
function Divider() {
  return (
    <div
      style={{
        borderTop: '1px solid var(--color-border)',
        margin: '4px 0',
      }}
    />
  );
}

export function App() {
  const { current, history, profile, lastUpdated, error, refreshNow } = useExtensionMessage();

  // Estado inicial antes de recibir datos de la extensión
  if (!current) {
    return (
      <div style={{ color: 'var(--color-muted)', fontSize: 12, padding: '8px 0' }}>
        Conectando...
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Banner de error (si existe) */}
      {error && (
        <div
          style={{
            backgroundColor: 'rgba(244, 67, 54, 0.12)',
            border: '1px solid var(--color-error)',
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 11,
            color: 'var(--color-error)',
          }}
        >
          {error}
        </div>
      )}

      {/* Perfil de cuenta */}
      {profile && (
        <>
          <AccountSummary profile={profile} />
          <Divider />
        </>
      )}

      {/* Medidores de uso */}
      <div>
        <UsageMeter
          label="Sesión (5h)"
          utilization={current.fiveHour.utilization}
          resetsAt={current.fiveHour.resetsAt}
        />
        <UsageMeter
          label="Semana (7d)"
          utilization={current.sevenDay.utilization}
          resetsAt={current.sevenDay.resetsAt}
        />
        <UsageMeter
          label="Sonnet (7d)"
          utilization={current.sevenDaySonnet.utilization}
          resetsAt={current.sevenDaySonnet.resetsAt}
        />
        <CreditsMeter
          usedCredits={current.extraUsage.usedCredits}
          monthlyLimit={current.extraUsage.monthlyLimit}
          isEnabled={current.extraUsage.isEnabled}
        />
      </div>

      {/* Gráfico de tendencia (visible sólo con suficiente historial) */}
      {history.length >= 2 && (
        <>
          <Divider />
          <MiniTrendChart snapshots={history} />
        </>
      )}

      <Divider />

      {/* Barra de estado y refresco */}
      <StatusBar lastUpdated={lastUpdated} onRefresh={refreshNow} />
    </div>
  );
}
