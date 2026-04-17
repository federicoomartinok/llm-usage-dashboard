import * as fs from 'fs';
import * as path from 'path';
import type { UsageSnapshot, AccountProfile } from '../providers/types';

export interface StorageStats {
  snapshotCount: number;
  storageBytes: number;
}

export class HtmlExporter {
  private outputPath: string;

  constructor(storageDir: string) {
    this.outputPath = path.join(storageDir, 'dashboard.html');
  }

  get filePath(): string {
    return this.outputPath;
  }

  generate(
    snapshot: UsageSnapshot | null,
    profile: AccountProfile | null,
    history: UsageSnapshot[],
    stats: StorageStats = { snapshotCount: 0, storageBytes: 0 }
  ): string {
    const html = buildHtml(snapshot, profile, history, stats);
    fs.writeFileSync(this.outputPath, html, 'utf-8');
    return html;
  }
}

// ============================================================
// Paleta y helpers de formato
// ============================================================

const COLOR = {
  bg: '#1e1e2e',
  card: '#313244',
  cardBorder: '#45475a',
  border: '#45475a',
  fg: '#cdd6f4',
  muted: '#a6adc8',
  mutedDim: '#6c7086',
  ok: '#a6e3a1',
  warn: '#f9e2af',
  warnStrong: '#fab387',
  error: '#f38ba8',
  accent: '#89b4fa',
  opus: '#cba6f7',
  sonnet: '#89b4fa',
} as const;

// Color según nivel de utilización — verde/amarillo/naranja/rojo
function utilizationColor(utilization: number): string {
  if (utilization >= 90) return COLOR.error;
  if (utilization >= 70) return COLOR.warnStrong;
  if (utilization >= 40) return COLOR.warn;
  return COLOR.ok;
}

// Formatea duración hasta un reset en formato legible (1d 2h, 3h 15m, 12m)
function formatResetRelative(resetsAt: string | null): string {
  if (!resetsAt) return '—';
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return 'reiniciando';

  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

// Fecha abreviada en español (ej. "mar 2026")
function formatMonthYear(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

// Enmascara email: fedemartindev05@gmail.com -> fede…@gmail.com
function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const keep = local.length <= 4 ? local : local.slice(0, 4);
  return `${keep}…@${domain}`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Nombre legible del plan (claude_max -> Claude Max)
function formatPlanName(planType: string): string {
  if (!planType) return '';
  const map: Record<string, string> = {
    claude_max: 'Claude Max',
    claude_pro: 'Claude Pro',
    claude_free: 'Claude Free',
    claude_team: 'Claude Team',
    claude_enterprise: 'Claude Enterprise',
  };
  return map[planType] ?? planType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================
// Gauge circular SVG
// ============================================================

interface GaugeProps {
  label: string;
  utilization: number;
  resetsAt: string | null;
}

// Radio 42 → circunferencia ≈ 263.89
const GAUGE_RADIUS = 42;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

function gaugeHtml({ label, utilization, resetsAt }: GaugeProps): string {
  const pct = Math.max(0, Math.min(100, utilization));
  const color = utilizationColor(pct);
  const offset = GAUGE_CIRCUMFERENCE * (1 - pct / 100);
  const resetText = formatResetRelative(resetsAt);

  return `
    <div class="gauge-card">
      <div class="gauge-circle">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="gauge-bg" cx="50" cy="50" r="${GAUGE_RADIUS}"/>
          <circle class="gauge-fill" cx="50" cy="50" r="${GAUGE_RADIUS}"
            stroke="${color}"
            stroke-dasharray="${GAUGE_CIRCUMFERENCE.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}"/>
        </svg>
        <div class="gauge-value" style="color:${color}">${pct.toFixed(0)}%</div>
      </div>
      <div class="gauge-label">${escapeHtml(label)}</div>
      <div class="gauge-reset">Resetea en ${resetText}</div>
    </div>`;
}

// ============================================================
// Card de créditos (Extra Usage)
// ============================================================

function creditsCardHtml(snapshot: UsageSnapshot | null): string {
  const extra = snapshot?.extraUsage;
  const enabled = extra?.isEnabled ?? false;
  const used = extra?.usedCredits ?? 0;
  const limit = extra?.monthlyLimit ?? 0;
  const utilizationPct = limit > 0 ? (used / limit) * 100 : 0;

  if (!enabled) {
    return `
      <div class="gauge-card credits-card disabled">
        <div class="credits-header">Extra Usage</div>
        <div class="credits-amount muted">—</div>
        <div class="credits-sub">Pay-as-you-go deshabilitado</div>
      </div>`;
  }

  return `
    <div class="gauge-card credits-card">
      <div class="credits-header">Extra Usage</div>
      <div class="credits-amount">${formatMoney(used)}</div>
      <div class="credits-sub">de ${formatMoney(limit)} mensuales</div>
      <div class="credits-bar">
        <div class="credits-bar-fill" style="width:${Math.min(100, utilizationPct).toFixed(1)}%"></div>
      </div>
      <div class="credits-pct">${utilizationPct.toFixed(1)}% utilizado</div>
    </div>`;
}

// ============================================================
// Chart de actividad 24h — bucketizado por hora
// ============================================================

interface HourBucket {
  hour: number; // 0..23 relative to now (23 = current hour)
  label: string; // HH:00
  opus: number; // % points of weekly quota consumidos por Opus/General
  sonnet: number; // % points consumidos por Sonnet
  hasData: boolean;
}

// Toma la última utilización registrada en cada hora de las últimas 24h.
// Devuelve 24 buckets ordenados cronológicamente (el último es "ahora").
function buildHourBuckets(history: UsageSnapshot[]): HourBucket[] {
  const now = new Date();
  const nowMs = now.getTime();
  const buckets: HourBucket[] = [];

  for (let i = 23; i >= 0; i--) {
    const bucketStart = nowMs - (i + 1) * 3_600_000;
    const bucketEnd = nowMs - i * 3_600_000;
    const inBucket = history.filter((s) => {
      const t = new Date(s.timestamp).getTime();
      return t >= bucketStart && t < bucketEnd;
    });

    const last = inBucket[inBucket.length - 1];
    const labelDate = new Date(bucketEnd);
    const label = `${labelDate.getHours().toString().padStart(2, '0')}:00`;

    if (!last) {
      buckets.push({ hour: 23 - i, label, opus: 0, sonnet: 0, hasData: false });
      continue;
    }

    const weekly = last.sevenDay.utilization;
    const sonnet = last.sevenDaySonnet.utilization;
    const opus = Math.max(0, weekly - sonnet);
    buckets.push({ hour: 23 - i, label, opus, sonnet, hasData: true });
  }

  return buckets;
}

function activityChartHtml(history: UsageSnapshot[]): string {
  const buckets = buildHourBuckets(history);
  const hasAnyData = buckets.some((b) => b.hasData);

  if (!hasAnyData) {
    return `
      <div class="chart-empty">
        <div class="chart-empty-icon">○</div>
        <div>Aún sin historial suficiente</div>
        <div class="chart-empty-sub">Los datos aparecerán a medida que se acumulen snapshots</div>
      </div>`;
  }

  // Escala al máximo real de la ventana para visibilizar variación
  const maxTotal = Math.max(...buckets.map((b) => b.opus + b.sonnet), 1);

  const barsHtml = buckets
    .map((b) => {
      if (!b.hasData) {
        return `<div class="bar-group empty" title="${b.label} · sin datos"></div>`;
      }
      const opusH = (b.opus / maxTotal) * 100;
      const sonnetH = (b.sonnet / maxTotal) * 100;
      const title = `${b.label} · ${(b.opus + b.sonnet).toFixed(1)}% quota (Opus ${b.opus.toFixed(1)} · Sonnet ${b.sonnet.toFixed(1)})`;
      // Ocultar bars con 0% para evitar slivers de 0px que rompen el gap visual
      const sonnetEl = sonnetH > 0.1 ? `<div class="bar-sonnet" style="height:${sonnetH.toFixed(1)}%"></div>` : '';
      const opusEl = opusH > 0.1 ? `<div class="bar-opus" style="height:${opusH.toFixed(1)}%"></div>` : '';
      return `<div class="bar-group" title="${title}">${sonnetEl}${opusEl}</div>`;
    })
    .join('');

  // Etiquetas cada 4h + "Ahora" al final
  const labels = [0, 4, 8, 12, 16, 20]
    .map((h) => {
      const d = new Date(Date.now() - (23 - h) * 3_600_000);
      return `<span>${d.getHours().toString().padStart(2, '0')}:00</span>`;
    })
    .concat(['<span class="label-now">Ahora</span>'])
    .join('');

  return `
    <div class="chart-wrap">
      <div class="chart-bars">${barsHtml}</div>
      <div class="chart-axis">${labels}</div>
      <div class="chart-legend">
        <span><i class="dot" style="background:${COLOR.opus}"></i>Opus / General</span>
        <span><i class="dot" style="background:${COLOR.sonnet}"></i>Sonnet</span>
      </div>
    </div>`;
}

// Stats chips — pico y promedio de las últimas 24h
function statsChipsHtml(history: UsageSnapshot[], snapshot: UsageSnapshot | null): string {
  if (history.length === 0 && !snapshot) return '';

  const all = history.length > 0 ? history : (snapshot ? [snapshot] : []);
  const weeklyValues = all.map((s) => s.sevenDay.utilization);
  const peak = Math.max(...weeklyValues, 0);
  const avg = weeklyValues.reduce((a, b) => a + b, 0) / Math.max(1, weeklyValues.length);

  return `
    <div class="stat-chips">
      <div class="stat-chip">
        <span class="stat-chip-label">Pico semanal</span>
        <span class="stat-chip-value" style="color:${utilizationColor(peak)}">${peak.toFixed(1)}%</span>
      </div>
      <div class="stat-chip">
        <span class="stat-chip-label">Promedio</span>
        <span class="stat-chip-value" style="color:${COLOR.muted}">${avg.toFixed(1)}%</span>
      </div>
      <div class="stat-chip">
        <span class="stat-chip-label">Lecturas</span>
        <span class="stat-chip-value" style="color:${COLOR.muted}">${all.length}</span>
      </div>
    </div>`;
}

// ============================================================
// Account card — tabla lateral
// ============================================================

function accountCardHtml(profile: AccountProfile | null): string {
  if (!profile) {
    return `
      <div class="card account-card">
        <h3>Cuenta</h3>
        <div class="muted">Sin perfil disponible</div>
      </div>`;
  }

  const statusActive = profile.subscriptionStatus === 'active';
  const plan = formatPlanName(profile.planType) || '—';
  const tier = profile.tier && profile.tier !== 'default' ? profile.tier : '—';

  return `
    <div class="card account-card">
      <h3>Cuenta</h3>
      <div class="account-row">
        <span class="label">Nombre</span>
        <span class="value">${escapeHtml(profile.displayName || '—')}</span>
      </div>
      <div class="account-row">
        <span class="label">Email</span>
        <span class="value">${escapeHtml(maskEmail(profile.email))}</span>
      </div>
      <div class="account-row">
        <span class="label">Plan</span>
        <span class="value" style="color:${COLOR.accent}">${escapeHtml(plan)}</span>
      </div>
      <div class="account-row">
        <span class="label">Tier</span>
        <span class="value">${escapeHtml(tier)}</span>
      </div>
      <div class="account-row">
        <span class="label">Facturación</span>
        <span class="value">${escapeHtml(profile.billingType || '—')}</span>
      </div>
      <div class="account-row">
        <span class="label">Estado</span>
        <span class="value" style="color:${statusActive ? COLOR.ok : COLOR.warn}">
          ${statusActive ? 'Activa' : escapeHtml(profile.subscriptionStatus || '—')}
        </span>
      </div>
      <div class="account-row">
        <span class="label">Miembro desde</span>
        <span class="value">${escapeHtml(formatMonthYear(profile.subscriptionCreatedAt))}</span>
      </div>
      <div class="account-row divider">
        <span class="label">Proveedor</span>
        <span class="value">Anthropic</span>
      </div>
    </div>`;
}

// ============================================================
// Header, tabs, status bar
// ============================================================

function headerHtml(profile: AccountProfile | null): string {
  const planChip = profile
    ? `<span class="plan-chip">${escapeHtml(formatPlanName(profile.planType))}${
        profile.tier && profile.tier !== 'default' ? ` · Tier ${escapeHtml(profile.tier)}` : ''
      }</span>`
    : '';
  const email = profile?.email ? `<span class="email">${escapeHtml(maskEmail(profile.email))}</span>` : '';

  return `
    <div class="header">
      <h1>
        LLM Usage Dashboard
        <span class="live-badge">
          <span class="live-dot"></span>LIVE
        </span>
      </h1>
      <div class="plan-info">
        ${email}
        ${planChip}
      </div>
    </div>`;
}

function providerTabsHtml(): string {
  return `
    <div class="provider-tabs">
      <div class="provider-tab active"><span class="tab-dot"></span>Anthropic</div>
      <div class="provider-tab disabled"><span class="tab-dot"></span>Google AI <small>(pronto)</small></div>
      <div class="provider-tab disabled"><span class="tab-dot"></span>OpenAI <small>(pronto)</small></div>
    </div>`;
}

function statusBarHtml(stats: StorageStats): string {
  const sizeText = stats.storageBytes > 0 ? formatBytes(stats.storageBytes) : '—';
  const now = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return `
    <div class="status-bar">
      <div class="live">
        <span class="pulse"></span>
        Actualizando cada 60s · Último: ${now}
      </div>
      <div class="storage">
        ${stats.snapshotCount.toLocaleString('es-AR')} snapshot${stats.snapshotCount === 1 ? '' : 's'} guardado${stats.snapshotCount === 1 ? '' : 's'}
        · JSON ${sizeText}
      </div>
    </div>`;
}

// ============================================================
// Document shell
// ============================================================

function buildHtml(
  snapshot: UsageSnapshot | null,
  profile: AccountProfile | null,
  history: UsageSnapshot[],
  stats: StorageStats
): string {
  const gaugesHtml = snapshot
    ? `
        ${gaugeHtml({ label: 'Session (5h)', utilization: snapshot.fiveHour.utilization, resetsAt: snapshot.fiveHour.resetsAt })}
        ${gaugeHtml({ label: 'Weekly (7d)', utilization: snapshot.sevenDay.utilization, resetsAt: snapshot.sevenDay.resetsAt })}
        ${gaugeHtml({ label: 'Weekly Sonnet', utilization: snapshot.sevenDaySonnet.utilization, resetsAt: snapshot.sevenDaySonnet.resetsAt })}
        ${creditsCardHtml(snapshot)}
      `
    : `<div class="gauges-empty">Sin datos de uso disponibles. Recopilando...</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="60">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Usage Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: ${COLOR.bg};
      color: ${COLOR.fg};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      min-height: 100vh;
      padding: 24px 20px 16px;
    }
    .container { max-width: 1180px; margin: 0 auto; }

    /* ---------- Header ---------- */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 20px;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .live-badge {
      background: ${COLOR.ok};
      color: ${COLOR.bg};
      font-size: 10px;
      padding: 3px 9px;
      border-radius: 999px;
      font-weight: 700;
      letter-spacing: 0.06em;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .live-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: ${COLOR.bg};
      animation: pulse 2s infinite;
    }
    .plan-info { display: flex; align-items: center; gap: 12px; font-size: 13px; color: ${COLOR.muted}; }
    .plan-info .email { font-variant-numeric: tabular-nums; }
    .plan-chip {
      background: ${COLOR.accent}22;
      border: 1px solid ${COLOR.accent}55;
      color: ${COLOR.accent};
      padding: 4px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
    }

    /* ---------- Provider tabs ---------- */
    .provider-tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
    .provider-tab {
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      border: 1px solid ${COLOR.border};
      background: transparent;
      color: ${COLOR.muted};
      display: flex; align-items: center; gap: 8px;
    }
    .provider-tab small { font-size: 11px; opacity: 0.8; }
    .provider-tab.active {
      background: ${COLOR.accent}22;
      border-color: ${COLOR.accent};
      color: ${COLOR.accent};
    }
    .provider-tab.disabled { opacity: 0.45; }
    .tab-dot { width: 6px; height: 6px; border-radius: 50%; background: ${COLOR.mutedDim}; }
    .provider-tab.active .tab-dot { background: ${COLOR.ok}; box-shadow: 0 0 4px ${COLOR.ok}; }

    /* ---------- Gauges row ---------- */
    .gauges-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 20px;
    }
    .gauges-empty {
      grid-column: 1 / -1;
      background: ${COLOR.card};
      border: 1px solid ${COLOR.cardBorder};
      border-radius: 12px;
      padding: 32px;
      text-align: center;
      color: ${COLOR.mutedDim};
      font-style: italic;
    }
    .gauge-card {
      background: ${COLOR.card};
      border: 1px solid ${COLOR.cardBorder};
      border-radius: 12px;
      padding: 18px 16px;
      text-align: center;
      transition: border-color 0.2s;
    }
    .gauge-card:hover { border-color: ${COLOR.accent}; }
    .gauge-circle { width: 100px; height: 100px; margin: 0 auto 10px; position: relative; }
    .gauge-circle svg { transform: rotate(-90deg); width: 100px; height: 100px; }
    .gauge-bg { fill: none; stroke: ${COLOR.cardBorder}; stroke-width: 8; }
    .gauge-fill {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.5s ease;
    }
    .gauge-value {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      font-size: 22px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .gauge-label { font-size: 13px; color: ${COLOR.muted}; margin-bottom: 4px; font-weight: 500; }
    .gauge-reset { font-size: 11px; color: ${COLOR.mutedDim}; }

    /* ---------- Credits card ---------- */
    .credits-card {
      text-align: left;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 18px 18px;
    }
    .credits-header { font-size: 13px; color: ${COLOR.muted}; margin-bottom: 6px; }
    .credits-amount {
      font-size: 28px;
      font-weight: 700;
      color: ${COLOR.ok};
      line-height: 1.1;
      margin-bottom: 3px;
    }
    .credits-amount.muted { color: ${COLOR.mutedDim}; font-size: 22px; }
    .credits-sub { font-size: 12px; color: ${COLOR.muted}; margin-bottom: 12px; }
    .credits-bar {
      height: 6px;
      background: ${COLOR.cardBorder};
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .credits-bar-fill {
      height: 100%;
      background: ${COLOR.ok};
      border-radius: 3px;
      transition: width 0.4s ease;
    }
    .credits-pct { font-size: 11px; color: ${COLOR.mutedDim}; }
    .credits-card.disabled { opacity: 0.55; }

    /* ---------- Charts row ---------- */
    .charts-row {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }
    .card {
      background: ${COLOR.card};
      border: 1px solid ${COLOR.cardBorder};
      border-radius: 12px;
      padding: 18px 20px;
    }
    .card h3 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 14px;
      color: ${COLOR.fg};
      display: flex; justify-content: space-between; align-items: baseline;
    }

    .stat-chips { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .stat-chip {
      display: flex; flex-direction: column;
      padding: 6px 12px;
      background: ${COLOR.bg};
      border: 1px solid ${COLOR.cardBorder};
      border-radius: 8px;
      min-width: 80px;
    }
    .stat-chip-label { font-size: 10px; color: ${COLOR.mutedDim}; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-chip-value { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }

    .chart-wrap {}
    .chart-bars {
      height: 180px;
      display: flex;
      align-items: flex-end;
      gap: 3px;
      padding-bottom: 4px;
      border-bottom: 1px solid ${COLOR.cardBorder};
    }
    .bar-group {
      flex: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      min-width: 6px;
      border-radius: 3px 3px 0 0;
      overflow: hidden;
      background: transparent;
    }
    .bar-group.empty {
      height: 4px;
      align-self: flex-end;
      background: repeating-linear-gradient(
        45deg,
        transparent, transparent 3px,
        ${COLOR.cardBorder} 3px, ${COLOR.cardBorder} 4px
      );
      opacity: 0.35;
    }
    .bar-opus {
      background: ${COLOR.opus};
      width: 100%;
      transition: height 0.3s;
    }
    .bar-sonnet {
      background: ${COLOR.sonnet};
      width: 100%;
      transition: height 0.3s;
    }
    .chart-axis {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 10px;
      color: ${COLOR.mutedDim};
      font-variant-numeric: tabular-nums;
    }
    .chart-axis .label-now { color: ${COLOR.accent}; font-weight: 600; }
    .chart-legend {
      display: flex; gap: 18px; margin-top: 12px; font-size: 12px; color: ${COLOR.muted};
    }
    .chart-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .chart-empty {
      height: 180px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: ${COLOR.mutedDim};
      gap: 4px;
    }
    .chart-empty-icon { font-size: 28px; opacity: 0.4; margin-bottom: 4px; }
    .chart-empty-sub { font-size: 11px; opacity: 0.7; }

    /* ---------- Account card ---------- */
    .account-card .account-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 0;
      font-size: 13px;
      border-bottom: 1px solid ${COLOR.cardBorder}44;
    }
    .account-card .account-row:last-child { border-bottom: none; }
    .account-card .account-row.divider {
      border-top: 1px solid ${COLOR.cardBorder};
      margin-top: 6px;
      padding-top: 10px;
    }
    .account-card .label { color: ${COLOR.muted}; }
    .account-card .value { color: ${COLOR.fg}; font-weight: 500; font-variant-numeric: tabular-nums; }
    .muted { color: ${COLOR.mutedDim}; font-style: italic; font-size: 13px; }

    /* ---------- Status bar ---------- */
    .status-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: ${COLOR.mutedDim};
      padding-top: 12px;
      border-top: 1px solid ${COLOR.cardBorder};
      flex-wrap: wrap;
      gap: 8px;
    }
    .status-bar .live { display: flex; align-items: center; gap: 6px; }
    .pulse {
      width: 6px; height: 6px; border-radius: 50%;
      background: ${COLOR.ok};
      box-shadow: 0 0 4px ${COLOR.ok};
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* ---------- Responsive ---------- */
    @media (max-width: 900px) {
      .gauges-row { grid-template-columns: repeat(2, 1fr); }
      .charts-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 520px) {
      .gauges-row { grid-template-columns: 1fr; }
      .header { flex-direction: column; align-items: flex-start; }
      .plan-info { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <div class="container">
    ${headerHtml(profile)}
    ${providerTabsHtml()}

    <div class="gauges-row">
      ${gaugesHtml}
    </div>

    <div class="charts-row">
      <div class="card">
        <h3>
          <span>Actividad últimas 24h</span>
        </h3>
        ${statsChipsHtml(history, snapshot)}
        ${activityChartHtml(history)}
      </div>

      ${accountCardHtml(profile)}
    </div>

    ${statusBarHtml(stats)}
  </div>
</body>
</html>`;
}
