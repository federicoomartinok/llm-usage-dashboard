import React from 'react';
import { useExtensionMessage } from './hooks/useExtensionMessage';
import { UsageMeter } from './components/UsageMeter';
import { CreditsMeter } from './components/CreditsMeter';
import { MiniTrendChart } from './components/MiniTrendChart';
import { AccountSummary } from './components/AccountSummary';
import { StatusBar } from './components/StatusBar';
import { BurnRateBadge } from './components/BurnRateBadge';

export function App() {
  const { current, history, profile, lastUpdated, error, refreshNow, metrics, creditsBurnUsdPerDay } =
    useExtensionMessage();

  if (!current) {
    return (
      <div
        style={{
          color: 'var(--color-muted)',
          fontSize: 12,
          padding: '12px 8px',
          textAlign: 'center',
        }}
      >
        <span className="animate-pulse-soft" style={{ display: 'inline-block' }}>
          Conectando...
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '2px' }}>
      {/* Banner de error */}
      {error && (
        <div
          className="glass-card"
          style={{
            padding: '7px 10px',
            fontSize: 11,
            color: 'var(--color-error)',
            borderColor: 'rgba(243, 139, 168, 0.4)',
            background: 'rgba(243, 139, 168, 0.08)',
          }}
        >
          {error}
        </div>
      )}

      {/* Account + burn rate header */}
      {profile && <AccountSummary profile={profile} />}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <BurnRateBadge burn={metrics.sevenDay.burn} projection={metrics.sevenDay.projection} />
      </div>

      {/* Medidores con sparklines y proyecciones */}
      <div>
        <UsageMeter
          label="Sesión 5h"
          utilization={current.fiveHour.utilization}
          resetsAt={current.fiveHour.resetsAt}
          sparkline={metrics.fiveHour.sparkline}
          delta={metrics.fiveHour.delta}
          projection={metrics.fiveHour.projection}
        />
        <UsageMeter
          label="Semanal 7d"
          utilization={current.sevenDay.utilization}
          resetsAt={current.sevenDay.resetsAt}
          sparkline={metrics.sevenDay.sparkline}
          delta={metrics.sevenDay.delta}
          projection={metrics.sevenDay.projection}
        />
        <UsageMeter
          label="Sonnet 7d"
          utilization={current.sevenDaySonnet.utilization}
          resetsAt={current.sevenDaySonnet.resetsAt}
          sparkline={metrics.sevenDaySonnet.sparkline}
          delta={metrics.sevenDaySonnet.delta}
          projection={metrics.sevenDaySonnet.projection}
          accentColor="var(--color-sonnet)"
        />
        <CreditsMeter
          usedCredits={current.extraUsage.usedCredits}
          monthlyLimit={current.extraUsage.monthlyLimit}
          isEnabled={current.extraUsage.isEnabled}
          burnUsdPerDay={creditsBurnUsdPerDay}
        />
      </div>

      {/* Tendencia (visible con suficiente historial) */}
      {history.length >= 2 && <MiniTrendChart snapshots={history} />}

      <StatusBar lastUpdated={lastUpdated} onRefresh={refreshNow} />
    </div>
  );
}
