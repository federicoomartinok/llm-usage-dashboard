import type { UsageSnapshot } from '../providers/types';

export interface AlertResult {
  level: 'warning' | 'critical';
  metric: string;
  utilization: number;
  resetsAt: string | null;
}

export interface AlertThresholds {
  warningThreshold: number;
  criticalThreshold: number;
}

// Métricas que se evalúan contra los umbrales de alerta
const MONITORED_METRICS: ReadonlyArray<{
  key: keyof Pick<UsageSnapshot, 'fiveHour' | 'sevenDay' | 'sevenDaySonnet'>;
  label: string;
}> = [
  { key: 'fiveHour', label: '5-Hour Window' },
  { key: 'sevenDay', label: '7-Day Window' },
  { key: 'sevenDaySonnet', label: '7-Day Sonnet' },
];

/**
 * Evalúa el snapshot contra los umbrales y retorna alertas activas.
 * El nivel crítico tiene precedencia sobre warning para la misma métrica.
 */
export function evaluateAlerts(
  snapshot: UsageSnapshot,
  thresholds: AlertThresholds
): AlertResult[] {
  const alerts: AlertResult[] = [];
  const { warningThreshold, criticalThreshold } = thresholds;

  for (const { key, label } of MONITORED_METRICS) {
    const window = snapshot[key];
    const utilizationPct = window.utilization * 100;

    if (utilizationPct >= criticalThreshold) {
      alerts.push({
        level: 'critical',
        metric: label,
        utilization: window.utilization,
        resetsAt: window.resetsAt,
      });
    } else if (utilizationPct >= warningThreshold) {
      alerts.push({
        level: 'warning',
        metric: label,
        utilization: window.utilization,
        resetsAt: window.resetsAt,
      });
    }
  }

  return alerts;
}

/**
 * Convierte una fecha ISO a tiempo legible hasta el reset.
 * Ejemplos: "2d 3h", "1h 23m", "45m", "ahora"
 */
export function formatResetTime(resetsAt: string | null): string {
  if (resetsAt === null) {
    return 'ahora';
  }

  const diffMs = new Date(resetsAt).getTime() - Date.now();

  if (diffMs <= 0) {
    return 'ahora';
  }

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalDays >= 1) {
    const remainingHours = totalHours % 24;
    return remainingHours > 0 ? `${totalDays}d ${remainingHours}h` : `${totalDays}d`;
  }

  if (totalHours >= 1) {
    const remainingMinutes = totalMinutes % 60;
    return remainingMinutes > 0 ? `${totalHours}h ${remainingMinutes}m` : `${totalHours}h`;
  }

  return `${totalMinutes}m`;
}
