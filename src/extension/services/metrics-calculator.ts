import type { UsageSnapshot } from '../providers/types';

// Funciones puras para derivar métricas a partir del historial de snapshots.
// Sin side effects ni dependencias de vscode — se importa también desde el webview.

export type WindowKey = 'fiveHour' | 'sevenDay' | 'sevenDaySonnet';
export type Severity = 'ok' | 'warn' | 'critical';
export type Trend = 'rising' | 'falling' | 'stable';
export type DeltaSign = 'up' | 'down' | 'flat';

export interface BurnRate {
  ratePctPerHour: number;
  trend: Trend;
  samplesUsed: number;
}

export interface Projection {
  exhaustsInMs: number | null;
  beforeReset: boolean;
  severity: Severity;
}

export interface Delta {
  deltaPct: number;
  deltaSign: DeltaSign;
}

export interface HeatmapCell {
  dayIndex: number; // 0=Lun, 6=Dom
  hour: number; // 0..23
  utilization: number;
  hasData: boolean;
  timestamp: string | null;
}

const HOUR_MS = 3_600_000;

// Devuelve el campo utilization de la ventana indicada
function pick(snap: UsageSnapshot, window: WindowKey): number {
  return snap[window].utilization;
}

// Tasa de consumo (% por hora) usando regresión lineal sobre últimas hoursBack horas.
// Pendiente positiva = sube; negativa = bajó (reset reciente).
export function calculateBurnRate(
  history: UsageSnapshot[],
  window: WindowKey,
  hoursBack: number
): BurnRate {
  const now = Date.now();
  const cutoff = now - hoursBack * HOUR_MS;
  const samples = history
    .filter((s) => new Date(s.timestamp).getTime() >= cutoff)
    .map((s) => ({ t: new Date(s.timestamp).getTime(), v: pick(s, window) }));

  if (samples.length < 2) {
    return { ratePctPerHour: 0, trend: 'stable', samplesUsed: samples.length };
  }

  // Regresión lineal: slope = Σ((t-t̄)(v-v̄)) / Σ((t-t̄)²)
  const n = samples.length;
  const tMean = samples.reduce((a, s) => a + s.t, 0) / n;
  const vMean = samples.reduce((a, s) => a + s.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of samples) {
    const dt = s.t - tMean;
    num += dt * (s.v - vMean);
    den += dt * dt;
  }
  const slopePerMs = den === 0 ? 0 : num / den;
  const ratePctPerHour = slopePerMs * HOUR_MS;

  // Trend con umbral para evitar ruido
  const trend: Trend =
    Math.abs(ratePctPerHour) < 0.05 ? 'stable' : ratePctPerHour > 0 ? 'rising' : 'falling';

  return { ratePctPerHour, trend, samplesUsed: n };
}

// Proyecta cuándo se alcanza el 100% al ritmo actual.
// Si la tasa es <=0 o el reset llega antes, beforeReset = false.
export function projectExhaustion(
  currentPct: number,
  ratePctPerHour: number,
  resetsAt: string | null
): Projection {
  if (ratePctPerHour <= 0 || currentPct >= 100) {
    return { exhaustsInMs: null, beforeReset: false, severity: severityFor(currentPct) };
  }

  const remainingPct = 100 - currentPct;
  const hoursToExhaust = remainingPct / ratePctPerHour;
  const exhaustsInMs = hoursToExhaust * HOUR_MS;

  if (!resetsAt) {
    return { exhaustsInMs, beforeReset: false, severity: severityFromHours(hoursToExhaust) };
  }

  const msToReset = new Date(resetsAt).getTime() - Date.now();
  const beforeReset = exhaustsInMs < msToReset;

  return {
    exhaustsInMs,
    beforeReset,
    severity: beforeReset ? 'critical' : severityFromHours(hoursToExhaust),
  };
}

function severityFor(pct: number): Severity {
  if (pct >= 90) return 'critical';
  if (pct >= 70) return 'warn';
  return 'ok';
}

function severityFromHours(hours: number): Severity {
  if (hours < 6) return 'critical';
  if (hours < 24) return 'warn';
  return 'ok';
}

// Diferencia vs snapshot ~1h atrás (busca el más cercano en ±30 min).
export function calculateDelta(history: UsageSnapshot[], window: WindowKey): Delta {
  if (history.length < 2) return { deltaPct: 0, deltaSign: 'flat' };

  const last = history[history.length - 1];
  const target = new Date(last.timestamp).getTime() - HOUR_MS;
  const tolerance = 30 * 60_000;

  let best: UsageSnapshot | null = null;
  let bestDiff = Infinity;
  for (const s of history.slice(0, -1)) {
    const diff = Math.abs(new Date(s.timestamp).getTime() - target);
    if (diff < bestDiff && diff <= tolerance) {
      bestDiff = diff;
      best = s;
    }
  }

  if (!best) return { deltaPct: 0, deltaSign: 'flat' };

  const deltaPct = pick(last, window) - pick(best, window);
  const deltaSign: DeltaSign =
    Math.abs(deltaPct) < 0.05 ? 'flat' : deltaPct > 0 ? 'up' : 'down';

  return { deltaPct, deltaSign };
}

// Serie de N puntos hacia atrás (uno por hora). El último corresponde a la hora actual.
export function buildSparkline(
  history: UsageSnapshot[],
  window: WindowKey,
  hoursBack: number
): number[] {
  const now = Date.now();
  const points: number[] = [];

  for (let i = hoursBack - 1; i >= 0; i--) {
    const bucketStart = now - (i + 1) * HOUR_MS;
    const bucketEnd = now - i * HOUR_MS;
    const inBucket = history.filter((s) => {
      const t = new Date(s.timestamp).getTime();
      return t >= bucketStart && t < bucketEnd;
    });
    const last = inBucket[inBucket.length - 1];
    points.push(last ? pick(last, window) : 0);
  }

  return points;
}

// Heatmap 7d × 24h. Devuelve grid [day][hour] con max utilización en ese bucket.
// dayIndex: 0=Lun ... 6=Dom (orden visual europeo).
export function buildHeatmapBuckets(history: UsageSnapshot[]): HeatmapCell[][] {
  const grid: HeatmapCell[][] = [];
  for (let d = 0; d < 7; d++) {
    grid.push([]);
    for (let h = 0; h < 24; h++) {
      grid[d].push({ dayIndex: d, hour: h, utilization: 0, hasData: false, timestamp: null });
    }
  }

  const now = Date.now();
  const cutoff = now - 7 * 24 * HOUR_MS;

  for (const snap of history) {
    const t = new Date(snap.timestamp).getTime();
    if (t < cutoff) continue;
    const d = new Date(snap.timestamp);
    // getDay(): 0=Dom, 1=Lun ... convertir a 0=Lun ... 6=Dom
    const dayIndex = (d.getDay() + 6) % 7;
    const hour = d.getHours();
    const cell = grid[dayIndex][hour];
    const v = snap.sevenDay.utilization;
    if (!cell.hasData || v > cell.utilization) {
      cell.utilization = v;
      cell.hasData = true;
      cell.timestamp = snap.timestamp;
    }
  }

  return grid;
}

// Helper compartido: formatea ms a "Xd Yh" o "Xh Ym".
export function formatDurationCompact(ms: number): string {
  if (ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
