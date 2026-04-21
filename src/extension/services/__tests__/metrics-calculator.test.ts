import { describe, it, expect } from 'vitest';
import {
  calculateBurnRate,
  projectExhaustion,
  calculateDelta,
  buildSparkline,
  buildHeatmapBuckets,
  formatDurationCompact,
} from '../metrics-calculator';
import type { UsageSnapshot } from '../../providers/types';

// Helper: arma snapshots con timestamps relativos a ahora
function snap(hoursAgo: number, fiveHourPct: number, weeklyPct = 0, sonnetPct = 0): UsageSnapshot {
  const t = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return {
    provider: 'anthropic',
    timestamp: t,
    fiveHour: { utilization: fiveHourPct, resetsAt: null },
    sevenDay: { utilization: weeklyPct, resetsAt: null },
    sevenDaySonnet: { utilization: sonnetPct, resetsAt: null },
    extraUsage: { isEnabled: false, monthlyLimit: 0, usedCredits: 0, utilization: null },
  };
}

describe('calculateBurnRate', () => {
  it('detecta tasa positiva en serie creciente', () => {
    // 0% -> 10% -> 20% en 2h => ~10%/h
    const history = [snap(2, 0), snap(1, 10), snap(0, 20)];
    const result = calculateBurnRate(history, 'fiveHour', 6);
    expect(result.ratePctPerHour).toBeCloseTo(10, 0);
    expect(result.trend).toBe('rising');
    expect(result.samplesUsed).toBe(3);
  });

  it('detecta tasa cero en serie plana', () => {
    const history = [snap(2, 50), snap(1, 50), snap(0, 50)];
    const result = calculateBurnRate(history, 'fiveHour', 6);
    expect(result.ratePctPerHour).toBeCloseTo(0, 5);
    expect(result.trend).toBe('stable');
  });

  it('detecta tasa negativa tras reset', () => {
    const history = [snap(2, 80), snap(1, 30), snap(0, 5)];
    const result = calculateBurnRate(history, 'fiveHour', 6);
    expect(result.ratePctPerHour).toBeLessThan(0);
    expect(result.trend).toBe('falling');
  });

  it('devuelve cero con history vacío', () => {
    expect(calculateBurnRate([], 'fiveHour', 6)).toEqual({
      ratePctPerHour: 0,
      trend: 'stable',
      samplesUsed: 0,
    });
  });

  it('devuelve cero con un solo snapshot', () => {
    expect(calculateBurnRate([snap(0, 50)], 'fiveHour', 6).ratePctPerHour).toBe(0);
  });
});

describe('projectExhaustion', () => {
  it('devuelve null si la tasa es no positiva', () => {
    const r = projectExhaustion(50, 0, null);
    expect(r.exhaustsInMs).toBeNull();
    expect(r.beforeReset).toBe(false);
  });

  it('devuelve null si ya está saturado', () => {
    const r = projectExhaustion(100, 5, null);
    expect(r.exhaustsInMs).toBeNull();
    expect(r.severity).toBe('critical');
  });

  it('proyecta correctamente sin reset', () => {
    // 50% restante a 10%/h => 5h
    const r = projectExhaustion(50, 10, null);
    expect(r.exhaustsInMs).toBeCloseTo(5 * 3_600_000, -3);
  });

  it('marca critical cuando se agota antes del reset', () => {
    // 80% usado, ritmo 10%/h => 2h al 100%. Reset en 5h => beforeReset
    const resetsAt = new Date(Date.now() + 5 * 3_600_000).toISOString();
    const r = projectExhaustion(80, 10, resetsAt);
    expect(r.beforeReset).toBe(true);
    expect(r.severity).toBe('critical');
  });

  it('no marca critical si reset llega antes', () => {
    // 30% usado, ritmo 5%/h => 14h. Reset en 2h => no agotamiento
    const resetsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const r = projectExhaustion(30, 5, resetsAt);
    expect(r.beforeReset).toBe(false);
  });
});

describe('calculateDelta', () => {
  it('devuelve flat con un solo snapshot', () => {
    expect(calculateDelta([snap(0, 50)], 'fiveHour')).toEqual({
      deltaPct: 0,
      deltaSign: 'flat',
    });
  });

  it('devuelve up cuando el actual es mayor que hace 1h', () => {
    const history = [snap(1, 30), snap(0, 50)];
    const r = calculateDelta(history, 'fiveHour');
    expect(r.deltaPct).toBeCloseTo(20, 1);
    expect(r.deltaSign).toBe('up');
  });

  it('devuelve down cuando el actual es menor que hace 1h', () => {
    const history = [snap(1, 60), snap(0, 40)];
    const r = calculateDelta(history, 'fiveHour');
    expect(r.deltaPct).toBeCloseTo(-20, 1);
    expect(r.deltaSign).toBe('down');
  });

  it('devuelve flat sin snapshot dentro de la tolerancia ±30min', () => {
    // Hay un snap hace 10h y uno ahora: el de 10h cae fuera de la tolerancia
    const history = [snap(10, 30), snap(0, 60)];
    const r = calculateDelta(history, 'fiveHour');
    expect(r.deltaSign).toBe('flat');
  });
});

describe('buildSparkline', () => {
  it('devuelve N puntos con history vacío (todos cero)', () => {
    const points = buildSparkline([], 'fiveHour', 6);
    expect(points).toHaveLength(6);
    expect(points.every((p) => p === 0)).toBe(true);
  });

  it('llena buckets con la última lectura por hora', () => {
    const history = [snap(2.5, 30), snap(1.5, 50), snap(0.2, 70)];
    const points = buildSparkline(history, 'fiveHour', 4);
    expect(points).toHaveLength(4);
    expect(points[points.length - 1]).toBe(70);
  });
});

describe('buildHeatmapBuckets', () => {
  it('devuelve grid 7×24 vacío con history vacío', () => {
    const grid = buildHeatmapBuckets([]);
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(24);
    expect(grid.every((row) => row.every((cell) => !cell.hasData))).toBe(true);
  });

  it('marca el bucket correcto con datos', () => {
    const history = [snap(0, 0, 75)];
    const grid = buildHeatmapBuckets(history);
    const now = new Date();
    const dayIndex = (now.getDay() + 6) % 7;
    const hour = now.getHours();
    expect(grid[dayIndex][hour].hasData).toBe(true);
    expect(grid[dayIndex][hour].utilization).toBe(75);
  });

  it('mantiene el max cuando hay múltiples snaps en mismo bucket', () => {
    // Dos snaps en la misma hora con valores distintos
    const history = [snap(0.4, 0, 30), snap(0.1, 0, 80)];
    const grid = buildHeatmapBuckets(history);
    const now = new Date();
    const dayIndex = (now.getDay() + 6) % 7;
    const hour = now.getHours();
    expect(grid[dayIndex][hour].utilization).toBe(80);
  });
});

describe('formatDurationCompact', () => {
  it('formatea correctamente días/horas/minutos', () => {
    expect(formatDurationCompact(0)).toBe('0m');
    expect(formatDurationCompact(15 * 60_000)).toBe('15m');
    expect(formatDurationCompact(2.5 * 3_600_000)).toBe('2h 30m');
    expect(formatDurationCompact(26 * 3_600_000)).toBe('1d 2h');
  });
});
