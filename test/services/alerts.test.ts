import { describe, it, expect } from 'vitest';
import { evaluateAlerts, formatResetTime } from '../../src/extension/services/alerts';
import type { UsageSnapshot } from '../../src/extension/providers/types';

// Snapshot base con uso bajo — no debe disparar alertas
function makeSnapshot(overrides: Partial<{
  fiveHourUtil: number;
  sevenDayUtil: number;
  sevenDaySonnetUtil: number;
  resetsAt: string | null;
}>  = {}): UsageSnapshot {
  const {
    fiveHourUtil = 0.1,
    sevenDayUtil = 0.2,
    sevenDaySonnetUtil = 0.15,
    resetsAt = null,
  } = overrides;

  return {
    provider: 'anthropic',
    timestamp: new Date().toISOString(),
    fiveHour: { utilization: fiveHourUtil, resetsAt },
    sevenDay: { utilization: sevenDayUtil, resetsAt },
    sevenDaySonnet: { utilization: sevenDaySonnetUtil, resetsAt },
    extraUsage: { isEnabled: false, monthlyLimit: 0, usedCredits: 0, utilization: null },
  };
}

const DEFAULT_THRESHOLDS = { warningThreshold: 80, criticalThreshold: 95 };

describe('evaluateAlerts', () => {
  it('no retorna alertas cuando el uso está por debajo del umbral de warning', () => {
    const snapshot = makeSnapshot({ fiveHourUtil: 0.5, sevenDayUtil: 0.3, sevenDaySonnetUtil: 0.2 });
    const alerts = evaluateAlerts(snapshot, DEFAULT_THRESHOLDS);
    expect(alerts).toHaveLength(0);
  });

  it('retorna alerta warning cuando una métrica supera el umbral de warning', () => {
    // 85% >= 80% warning, < 95% critical
    const snapshot = makeSnapshot({ fiveHourUtil: 0.85, sevenDayUtil: 0.2, sevenDaySonnetUtil: 0.1 });
    const alerts = evaluateAlerts(snapshot, DEFAULT_THRESHOLDS);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      level: 'warning',
      metric: '5-Hour Window',
      utilization: 0.85,
    });
  });

  it('retorna alerta critical cuando una métrica supera el umbral crítico', () => {
    // 97% >= 95% critical
    const snapshot = makeSnapshot({ fiveHourUtil: 0.1, sevenDayUtil: 0.97, sevenDaySonnetUtil: 0.1 });
    const alerts = evaluateAlerts(snapshot, DEFAULT_THRESHOLDS);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      level: 'critical',
      metric: '7-Day Window',
      utilization: 0.97,
    });
  });

  it('no incluye alerta warning cuando la misma métrica ya supera el umbral crítico', () => {
    // 98% debe generar solo critical, no warning
    const snapshot = makeSnapshot({ fiveHourUtil: 0.98, sevenDayUtil: 0.1, sevenDaySonnetUtil: 0.1 });
    const alerts = evaluateAlerts(snapshot, DEFAULT_THRESHOLDS);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('critical');
  });

  it('retorna múltiples alertas cuando varias métricas superan sus umbrales', () => {
    const snapshot = makeSnapshot({
      fiveHourUtil: 0.96,   // critical
      sevenDayUtil: 0.82,   // warning
      sevenDaySonnetUtil: 0.99, // critical
    });
    const alerts = evaluateAlerts(snapshot, DEFAULT_THRESHOLDS);

    expect(alerts).toHaveLength(3);

    const fiveHourAlert = alerts.find(a => a.metric === '5-Hour Window');
    const sevenDayAlert = alerts.find(a => a.metric === '7-Day Window');
    const sonnetAlert = alerts.find(a => a.metric === '7-Day Sonnet');

    expect(fiveHourAlert?.level).toBe('critical');
    expect(sevenDayAlert?.level).toBe('warning');
    expect(sonnetAlert?.level).toBe('critical');
  });

  it('incluye resetsAt en la alerta cuando está disponible', () => {
    const resetsAt = new Date(Date.now() + 3600_000).toISOString();
    const snapshot = makeSnapshot({ fiveHourUtil: 0.9, resetsAt });
    const alerts = evaluateAlerts(snapshot, DEFAULT_THRESHOLDS);

    expect(alerts[0].resetsAt).toBe(resetsAt);
  });

  it('respeta umbrales personalizados', () => {
    // Con umbrales más bajos, 60% debe ser warning
    const snapshot = makeSnapshot({ fiveHourUtil: 0.6, sevenDayUtil: 0.1, sevenDaySonnetUtil: 0.1 });
    const alerts = evaluateAlerts(snapshot, { warningThreshold: 50, criticalThreshold: 75 });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('warning');
  });
});

describe('formatResetTime', () => {
  it('retorna "ahora" cuando resetsAt es null', () => {
    expect(formatResetTime(null)).toBe('ahora');
  });

  it('retorna "ahora" cuando la fecha ya pasó', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(formatResetTime(past)).toBe('ahora');
  });

  it('formatea correctamente minutos solamente', () => {
    const future = new Date(Date.now() + 45 * 60_000).toISOString();
    expect(formatResetTime(future)).toBe('45m');
  });

  it('formatea correctamente horas y minutos', () => {
    const future = new Date(Date.now() + (1 * 60 + 23) * 60_000).toISOString();
    expect(formatResetTime(future)).toBe('1h 23m');
  });

  it('formatea correctamente horas sin minutos sobrantes', () => {
    const future = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    expect(formatResetTime(future)).toBe('2h');
  });

  it('formatea correctamente días y horas', () => {
    const future = new Date(Date.now() + (2 * 24 + 3) * 60 * 60_000).toISOString();
    expect(formatResetTime(future)).toBe('2d 3h');
  });

  it('formatea correctamente días sin horas sobrantes', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    expect(formatResetTime(future)).toBe('7d');
  });
});
