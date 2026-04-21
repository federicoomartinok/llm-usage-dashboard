import { useState, useEffect, useCallback, useMemo } from 'react';
import type { UsageSnapshot, AccountProfile, ExtensionMessage, WebviewMessage } from '../../extension/providers/types';
import {
  calculateBurnRate,
  projectExhaustion,
  calculateDelta,
  buildSparkline,
  type BurnRate,
  type Projection,
  type Delta,
  type WindowKey,
} from '../../extension/services/metrics-calculator';

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewMessage): void;
};

interface ExtensionState {
  current: UsageSnapshot | null;
  history: UsageSnapshot[];
  profile: AccountProfile | null;
  lastUpdated: Date | null;
  error: string | null;
}

export interface WindowMetrics {
  burn: BurnRate;
  projection: Projection | null;
  delta: Delta;
  sparkline: number[];
}

const vscode = acquireVsCodeApi();

export function useExtensionMessage() {
  const [state, setState] = useState<ExtensionState>({
    current: null,
    history: [],
    profile: null,
    lastUpdated: null,
    error: null,
  });

  useEffect(() => {
    function handleMessage(event: MessageEvent<ExtensionMessage>) {
      const msg = event.data;

      switch (msg.type) {
        case 'state':
          setState((prev) => ({
            ...prev,
            current: msg.current,
            history: msg.history,
            profile: msg.profile,
            lastUpdated: new Date(),
            error: null,
          }));
          break;

        case 'usage-update':
          setState((prev) => ({
            ...prev,
            current: msg.data,
            // Append al history para que sparklines/delta se actualicen sin esperar al siguiente 'state'
            history: prev.history.length > 0 ? [...prev.history.slice(-200), msg.data] : prev.history,
            lastUpdated: new Date(),
            error: null,
          }));
          break;

        case 'profile-update':
          setState((prev) => ({
            ...prev,
            profile: msg.data,
          }));
          break;

        case 'error':
          setState((prev) => ({
            ...prev,
            error: msg.message,
          }));
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'init' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const refreshNow = useCallback(() => {
    vscode.postMessage({ type: 'refresh-now' });
  }, []);

  const requestHistory = useCallback((hours: number) => {
    vscode.postMessage({ type: 'request-history', hours });
  }, []);

  // Métricas derivadas memoizadas — recalculan solo cuando cambia history o current
  const metrics = useMemo(() => {
    const { current, history } = state;
    return {
      fiveHour: deriveWindow(current, history, 'fiveHour', 3, 6),
      sevenDay: deriveWindow(current, history, 'sevenDay', 6, 12),
      sevenDaySonnet: deriveWindow(current, history, 'sevenDaySonnet', 6, 12),
    };
  }, [state.current, state.history]);

  // Burn rate USD/día sobre extra usage (24h)
  const creditsBurnUsdPerDay = useMemo(() => {
    const { history } = state;
    const dayCutoff = Date.now() - 24 * 3_600_000;
    const recent = history.filter((s) => new Date(s.timestamp).getTime() >= dayCutoff);
    if (recent.length < 2) return 0;
    const first = recent[0].extraUsage.usedCredits;
    const last = recent[recent.length - 1].extraUsage.usedCredits;
    const elapsedHours =
      (new Date(recent[recent.length - 1].timestamp).getTime() -
        new Date(recent[0].timestamp).getTime()) /
      3_600_000;
    if (elapsedHours <= 0) return 0;
    return ((last - first) / elapsedHours) * 24;
  }, [state.history]);

  return { ...state, refreshNow, requestHistory, metrics, creditsBurnUsdPerDay };
}

function deriveWindow(
  current: UsageSnapshot | null,
  history: UsageSnapshot[],
  window: WindowKey,
  burnHoursBack: number,
  sparkHoursBack: number
): WindowMetrics {
  const burn = calculateBurnRate(history, window, burnHoursBack);
  const projection = current
    ? projectExhaustion(current[window].utilization, burn.ratePctPerHour, current[window].resetsAt)
    : null;
  return {
    burn,
    projection,
    delta: calculateDelta(history, window),
    sparkline: buildSparkline(history, window, sparkHoursBack),
  };
}
