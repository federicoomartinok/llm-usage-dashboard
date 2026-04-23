import * as fs from 'fs';
import * as path from 'path';
import type { UsageSnapshot, AccountProfile } from '../providers/types';
import {
  calculateBurnRate,
  projectExhaustion,
  calculateDelta,
  calculateWeeklyDelta,
  buildSparkline,
  buildHeatmapBuckets,
  formatDurationCompact,
  type BurnRate,
  type Projection,
  type Delta,
  type HeatmapCell,
  type Severity,
  type WindowKey,
} from './metrics-calculator';

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
// Paleta Catppuccin Mocha + helpers
// ============================================================

const COLOR = {
  bg: '#11111b',
  bgSoft: '#1e1e2e',
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
  pink: '#f5c2e7',
} as const;

function utilizationColor(utilization: number): string {
  if (utilization >= 90) return COLOR.error;
  if (utilization >= 70) return COLOR.warnStrong;
  if (utilization >= 40) return COLOR.warn;
  return COLOR.ok;
}

function severityColor(sev: Severity): string {
  if (sev === 'critical') return COLOR.error;
  if (sev === 'warn') return COLOR.warnStrong;
  return COLOR.ok;
}

function formatResetRelative(resetsAt: string | null): string {
  if (!resetsAt) return '—';
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return 'reiniciando';
  return formatDurationCompact(diff);
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatMonthYear(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

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
// Sparkline SVG inline (mini trend)
// ============================================================

function sparklineSvg(points: number[], color: string, width = 80, height = 22): string {
  if (points.length < 2) {
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"></svg>`;
  }
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(1, max - min);
  const stepX = width / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (height - ((p - min) / range) * height).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  const areaPath = `${path} L${width},${height} L0,${height} Z`;
  const gradId = `spark-${Math.random().toString(36).slice(2, 8)}`;

  return `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" class="sparkline">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${gradId})"/>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}

// ============================================================
// Delta badge (▲ ▼ —)
// ============================================================

function deltaBadge(delta: Delta, invert = false): string {
  if (delta.deltaSign === 'flat') {
    return `<span class="delta delta-flat">— estable</span>`;
  }
  const isUp = delta.deltaSign === 'up';
  // En usage, "subir" suele ser malo; permitimos invertir la semántica si fuera necesario
  const bad = invert ? !isUp : isUp;
  const cls = bad ? 'delta-up' : 'delta-down';
  const arrow = isUp ? '▲' : '▼';
  return `<span class="delta ${cls}">${arrow} ${Math.abs(delta.deltaPct).toFixed(1)}%</span>`;
}

// ============================================================
// Hero KPI card (gauge + sparkline + delta + projection)
// ============================================================

interface HeroKpiProps {
  label: string;
  utilization: number;
  resetsAt: string | null;
  sparkline: number[];
  delta: Delta;
  burn: BurnRate;
  projection: Projection;
  accentColor?: string;
}

const GAUGE_RADIUS = 42;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

function heroKpiCard(p: HeroKpiProps): string {
  const pct = Math.max(0, Math.min(100, p.utilization));
  const color = p.accentColor ?? utilizationColor(pct);
  const offset = GAUGE_CIRCUMFERENCE * (1 - pct / 100);
  const resetText = formatResetRelative(p.resetsAt);
  const burnText =
    p.burn.samplesUsed >= 2
      ? `${p.burn.ratePctPerHour >= 0 ? '+' : ''}${p.burn.ratePctPerHour.toFixed(2)}%/h`
      : '—';
  const projText =
    p.projection.exhaustsInMs && p.projection.beforeReset
      ? `agota en ${formatDurationCompact(p.projection.exhaustsInMs)}`
      : p.projection.exhaustsInMs
        ? `proyec ${formatDurationCompact(p.projection.exhaustsInMs)}`
        : 'sin riesgo';
  const projColor = severityColor(p.projection.severity);

  return `
    <div class="hero-card">
      <div class="hero-top">
        <div class="hero-label">${escapeHtml(p.label)}</div>
        ${deltaBadge(p.delta)}
      </div>
      <div class="hero-mid">
        <div class="gauge-circle">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="grad-${p.label.replace(/\s+/g, '-')}" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="${color}" stop-opacity="1"/>
                <stop offset="100%" stop-color="${color}" stop-opacity="0.55"/>
              </linearGradient>
            </defs>
            <circle class="gauge-bg" cx="50" cy="50" r="${GAUGE_RADIUS}"/>
            <circle class="gauge-fill" cx="50" cy="50" r="${GAUGE_RADIUS}"
              stroke="url(#grad-${p.label.replace(/\s+/g, '-')})"
              stroke-dasharray="${GAUGE_CIRCUMFERENCE.toFixed(2)}"
              stroke-dashoffset="${offset.toFixed(2)}"/>
          </svg>
          <div class="gauge-value" style="color:${color}">
            <span class="gauge-pct">${pct.toFixed(0)}</span><span class="gauge-pct-sym">%</span>
          </div>
        </div>
        <div class="hero-spark">${sparklineSvg(p.sparkline, color, 90, 28)}</div>
      </div>
      <div class="hero-foot">
        <span class="hero-burn" title="Burn rate (regresión sobre las últimas 6h)">${burnText}</span>
        <span class="hero-reset">reset ${resetText}</span>
      </div>
      <div class="hero-projection" style="color:${projColor}">
        <span class="proj-dot" style="background:${projColor}"></span>${projText}
      </div>
    </div>`;
}

// ============================================================
// Card de créditos (Extra Usage)
// ============================================================

function creditsCardHtml(snapshot: UsageSnapshot | null, history: UsageSnapshot[]): string {
  const extra = snapshot?.extraUsage;
  const used = extra?.usedCredits ?? 0;
  const limit = extra?.monthlyLimit ?? 0;
  const utilizationPct = limit > 0 ? (used / limit) * 100 : 0;

  // Burn de créditos en USD/día (24h)
  const dayMs = 24 * 3_600_000;
  const dayCutoff = Date.now() - dayMs;
  const recent = history.filter((s) => new Date(s.timestamp).getTime() >= dayCutoff);
  let burnUsdPerDay = 0;
  if (recent.length >= 2) {
    const first = recent[0].extraUsage.usedCredits;
    const last = recent[recent.length - 1].extraUsage.usedCredits;
    const elapsedHours =
      (new Date(recent[recent.length - 1].timestamp).getTime() -
        new Date(recent[0].timestamp).getTime()) /
      3_600_000;
    if (elapsedHours > 0) {
      burnUsdPerDay = ((last - first) / elapsedHours) * 24;
    }
  }

  return `
    <div class="hero-card credits-card">
      <div class="hero-top">
        <div class="hero-label">Extra Usage</div>
      </div>
      <div class="credits-amount">${formatMoney(used)}</div>
      <div class="credits-sub">de ${formatMoney(limit)} mensuales</div>
      <div class="credits-bar">
        <div class="credits-bar-fill" style="width:${Math.min(100, utilizationPct).toFixed(1)}%"></div>
      </div>
      <div class="hero-foot">
        <span class="hero-burn">${burnUsdPerDay >= 0 ? '+' : ''}${formatMoney(burnUsdPerDay)}/día</span>
        <span class="hero-reset">${limit > 0 ? `${utilizationPct.toFixed(1)}% del mes` : 'sin créditos cargados'}</span>
      </div>
    </div>`;
}

// ============================================================
// Heatmap 7d × 24h
// ============================================================

function heatmapHtml(history: UsageSnapshot[]): string {
  const grid = buildHeatmapBuckets(history);
  const hasAny = grid.some((row) => row.some((c) => c.hasData));

  const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  if (!hasAny) {
    return `
      <div class="card heatmap-card">
        <h3><span>Patrón semanal</span><small class="card-sub">7d × 24h</small></h3>
        <div class="chart-empty">
          <div class="chart-empty-icon">○</div>
          <div>Aún sin patrón suficiente</div>
          <div class="chart-empty-sub">Las celdas se irán pintando con el correr de los días</div>
        </div>
      </div>`;
  }

  const now = new Date();
  const todayDayIndex = (now.getDay() + 6) % 7;
  const currentHour = now.getHours();

  const rowsHtml = grid
    .map((row, di) => {
      const cellsHtml = row
        .map((cell) => cellHtml(cell, di === todayDayIndex && cell.hour === currentHour))
        .join('');
      const isToday = di === todayDayIndex;
      return `
        <div class="hm-row${isToday ? ' hm-row-today' : ''}">
          <div class="hm-day-label">${days[di]}</div>
          ${cellsHtml}
        </div>`;
    })
    .join('');

  // Etiquetas horarias en eje superior
  const hourLabels = [0, 6, 12, 18]
    .map((h) => `<span style="left:calc(${(h / 24) * 100}% + 24px)">${h.toString().padStart(2, '0')}h</span>`)
    .join('');

  return `
    <div class="card heatmap-card">
      <h3><span>Patrón semanal</span><small class="card-sub">7d × 24h · pico semanal por hora</small></h3>
      <div class="hm-axis">${hourLabels}</div>
      <div class="hm-grid">${rowsHtml}</div>
      <div class="hm-legend">
        <span>menos</span>
        <span class="hm-scale">
          <i style="background:${COLOR.cardBorder}"></i>
          <i style="background:${COLOR.ok}88"></i>
          <i style="background:${COLOR.warn}aa"></i>
          <i style="background:${COLOR.warnStrong}cc"></i>
          <i style="background:${COLOR.error}"></i>
        </span>
        <span>más</span>
      </div>
    </div>`;
}

function cellHtml(cell: HeatmapCell, isCurrent: boolean): string {
  const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  if (!cell.hasData) {
    const title = `${days[cell.dayIndex]} ${cell.hour.toString().padStart(2, '0')}:00 · sin datos`;
    return `<div class="hm-cell hm-empty${isCurrent ? ' hm-now' : ''}" title="${title}"></div>`;
  }
  const pct = cell.utilization;
  const color = utilizationColor(pct);
  const opacity = Math.max(0.18, Math.min(1, pct / 100));
  const title = `${days[cell.dayIndex]} ${cell.hour.toString().padStart(2, '0')}:00 · ${pct.toFixed(1)}%`;
  return `<div class="hm-cell${isCurrent ? ' hm-now' : ''}" style="background:${color};opacity:${opacity.toFixed(2)}" title="${title}"></div>`;
}

// ============================================================
// Activity chart 24h (barras Opus/Sonnet apiladas) — restyle
// ============================================================

interface DeltaBucket {
  hour: number;
  label: string;
  deltaTotal: number;   // % de cuota 7d consumido en esa hora
  deltaSonnet: number;  // % atribuible a Sonnet
  hasData: boolean;
}

// Deltas por hora: cada bucket muestra cuánto subió el acumulado 7d en esa hora.
// Si la cuota se reseteó (valor baja), el delta se clampa a 0.
function buildDeltaBuckets(history: UsageSnapshot[]): DeltaBucket[] {
  const now = Date.now();
  const cumulative: Array<{ hour: number; label: string; total: number; sonnet: number; hasData: boolean }> = [];

  for (let i = 23; i >= 0; i--) {
    const bucketStart = now - (i + 1) * 3_600_000;
    const bucketEnd = now - i * 3_600_000;
    const inBucket = history.filter((s) => {
      const t = new Date(s.timestamp).getTime();
      return t >= bucketStart && t < bucketEnd;
    });
    const last = inBucket[inBucket.length - 1];
    const label = `${new Date(bucketEnd).getHours().toString().padStart(2, '0')}:00`;

    cumulative.push(
      last
        ? { hour: 23 - i, label, total: last.sevenDay.utilization, sonnet: last.sevenDaySonnet.utilization, hasData: true }
        : { hour: 23 - i, label, total: 0, sonnet: 0, hasData: false }
    );
  }

  // Referencia inicial: último snapshot anterior a la ventana 24h
  const windowStart = now - 24 * 3_600_000;
  const before = history.filter((s) => new Date(s.timestamp).getTime() < windowStart);
  const lastBefore = before[before.length - 1];
  let prevTotal: number | null = lastBefore?.sevenDay.utilization ?? null;
  let prevSonnet: number | null = lastBefore?.sevenDaySonnet.utilization ?? null;

  return cumulative.map((b) => {
    if (!b.hasData) {
      return { hour: b.hour, label: b.label, deltaTotal: 0, deltaSonnet: 0, hasData: false };
    }
    const dT = prevTotal === null ? 0 : Math.max(0, b.total - prevTotal);
    const dS = prevSonnet === null ? 0 : Math.max(0, b.sonnet - prevSonnet);
    prevTotal = b.total;
    prevSonnet = b.sonnet;
    return { hour: b.hour, label: b.label, deltaTotal: dT, deltaSonnet: dS, hasData: true };
  });
}


function activityChartHtml(history: UsageSnapshot[]): string {
  const buckets = buildDeltaBuckets(history);
  const hasAnyData = buckets.some((b) => b.hasData);
  const hasAnyDelta = buckets.some((b) => b.deltaTotal > 0.005);

  if (!hasAnyData) {
    return `
      <div class="chart-empty">
        <div class="chart-empty-icon">○</div>
        <div>Aún sin historial suficiente</div>
        <div class="chart-empty-sub">Los datos aparecerán a medida que se acumulen snapshots</div>
      </div>`;
  }

  const maxDelta = Math.max(...buckets.map((b) => b.deltaTotal), 0.1);

  const barsHtml = buckets
    .map((b) => {
      if (!b.hasData) {
        return `<div class="bar-group empty" title="${b.label} · sin datos"></div>`;
      }
      if (b.deltaTotal <= 0.005) {
        return `<div class="bar-group" title="${b.label} · sin consumo"></div>`;
      }
      const totalH = (b.deltaTotal / maxDelta) * 100;
      const sonnetPortion = b.deltaTotal > 0 ? b.deltaSonnet / b.deltaTotal : 0;
      const sonnetPct = (sonnetPortion * 100).toFixed(1);
      const opusPct = ((1 - sonnetPortion) * 100).toFixed(1);
      const opusDelta = Math.max(0, b.deltaTotal - b.deltaSonnet);
      const glow = b.deltaTotal >= 0.3 ? `box-shadow:0 0 6px ${COLOR.accent}55;` : '';
      const title = `${b.label} · +${b.deltaTotal.toFixed(2)}% total (Opus +${opusDelta.toFixed(2)} · Sonnet +${b.deltaSonnet.toFixed(2)})`;
      const sonnetEl = sonnetPortion > 0.005 ? `<div class="bar-sonnet" style="height:${sonnetPct}%"></div>` : '';
      const opusEl = sonnetPortion < 0.995 ? `<div class="bar-opus" style="height:${opusPct}%"></div>` : '';
      return `<div class="bar-group" title="${title}"><div class="bar-stack" style="height:${totalH.toFixed(1)}%;${glow}">${sonnetEl}${opusEl}</div></div>`;
    })
    .join('');

  const labels = [0, 4, 8, 12, 16, 20]
    .map((h) => {
      const d = new Date(Date.now() - (23 - h) * 3_600_000);
      return `<span>${d.getHours().toString().padStart(2, '0')}:00</span>`;
    })
    .concat(['<span class="label-now">Ahora</span>'])
    .join('');

  const legendHtml = hasAnyDelta
    ? `
      <div class="chart-legend">
        <span><i class="dot" style="background:${COLOR.opus}"></i>Opus / General</span>
        <span><i class="dot" style="background:${COLOR.sonnet}"></i>Sonnet</span>
      </div>`
    : `
      <div class="chart-legend">
        <span class="chart-legend-label">sin consumo en esta ventana</span>
      </div>`;

  return `
    <div class="chart-wrap">
      <div class="chart-bars">${barsHtml}</div>
      <div class="chart-axis">${labels}</div>
      ${legendHtml}
    </div>`;
}

function statsChipsHtml(history: UsageSnapshot[], snapshot: UsageSnapshot | null): string {
  if (history.length === 0 && !snapshot) return '';

  const all = history.length > 0 ? history : (snapshot ? [snapshot] : []);
  const weeklyValues = all.map((s) => s.sevenDay.utilization);
  const peak = Math.max(...weeklyValues, 0);
  const avg = weeklyValues.reduce((a, b) => a + b, 0) / Math.max(1, weeklyValues.length);
  const sessionPeak = Math.max(...all.map((s) => s.fiveHour.utilization), 0);

  const weeklyDelta = calculateWeeklyDelta(all, 'sevenDay');
  const deltaText =
    weeklyDelta.deltaSign === 'flat'
      ? '— igual'
      : `${weeklyDelta.deltaSign === 'up' ? '▲' : '▼'} ${Math.abs(weeklyDelta.deltaPct).toFixed(1)}%`;
  const deltaColor =
    weeklyDelta.deltaSign === 'flat'
      ? COLOR.mutedDim
      : weeklyDelta.deltaSign === 'up'
        ? COLOR.error
        : COLOR.ok;

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
        <span class="stat-chip-label">Pico sesión</span>
        <span class="stat-chip-value" style="color:${utilizationColor(sessionPeak)}">${sessionPeak.toFixed(1)}%</span>
      </div>
      <div class="stat-chip">
        <span class="stat-chip-label">vs sem. ant.</span>
        <span class="stat-chip-value" style="color:${deltaColor}">${deltaText}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-chip-label">Lecturas</span>
        <span class="stat-chip-value" style="color:${COLOR.muted}">${all.length}</span>
      </div>
    </div>`;
}

// ============================================================
// Account card
// ============================================================

// ============================================================
// Header (con burn rate global)
// ============================================================

function headerHtml(profile: AccountProfile | null, snapshot: UsageSnapshot | null, history: UsageSnapshot[]): string {
  const planChip = profile
    ? `<span class="plan-chip">${escapeHtml(formatPlanName(profile.planType))}${
        profile.tier && profile.tier !== 'default' ? ` · Tier ${escapeHtml(profile.tier)}` : ''
      }</span>`
    : '';
  const email = profile?.email ? `<span class="email">${escapeHtml(maskEmail(profile.email))}</span>` : '';

  // Burn rate semanal (la métrica más relevante para el plan)
  const weeklyBurn = calculateBurnRate(history, 'sevenDay', 6);
  const weeklyProj = snapshot
    ? projectExhaustion(snapshot.sevenDay.utilization, weeklyBurn.ratePctPerHour, snapshot.sevenDay.resetsAt)
    : null;
  const burnColor = severityColor(weeklyProj?.severity ?? 'ok');
  const burnPill =
    weeklyBurn.samplesUsed >= 2
      ? `
        <div class="burn-pill" style="border-color:${burnColor}55; color:${burnColor}">
          <span class="burn-icon">🔥</span>
          <div class="burn-text">
            <span class="burn-rate">${weeklyBurn.ratePctPerHour >= 0 ? '+' : ''}${weeklyBurn.ratePctPerHour.toFixed(2)}%/h</span>
            <span class="burn-sub">${
              weeklyProj?.exhaustsInMs && weeklyProj.beforeReset
                ? `agota en ${formatDurationCompact(weeklyProj.exhaustsInMs)}`
                : weeklyBurn.trend === 'falling'
                  ? 'reseteando'
                  : 'sin riesgo'
            }</span>
          </div>
        </div>`
      : '';

  return `
    <div class="header">
      <div class="header-left">
        <h1>
          LLM Usage
          <span class="live-badge">
            <span class="live-dot"></span>LIVE
          </span>
        </h1>
        <div class="plan-info">
          ${email}
          ${planChip}
        </div>
      </div>
      <div class="header-right">
        ${burnPill}
      </div>
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
  // Métricas derivadas por ventana
  const heroes = snapshot
    ? `
        ${heroKpiCard({
          label: 'Sesión 5h',
          utilization: snapshot.fiveHour.utilization,
          resetsAt: snapshot.fiveHour.resetsAt,
          sparkline: buildSparkline(history, 'fiveHour', 6),
          delta: calculateDelta(history, 'fiveHour'),
          burn: calculateBurnRate(history, 'fiveHour', 3),
          projection: projectExhaustion(
            snapshot.fiveHour.utilization,
            calculateBurnRate(history, 'fiveHour', 3).ratePctPerHour,
            snapshot.fiveHour.resetsAt
          ),
        })}
        ${heroKpiCard({
          label: 'Semanal 7d',
          utilization: snapshot.sevenDay.utilization,
          resetsAt: snapshot.sevenDay.resetsAt,
          sparkline: buildSparkline(history, 'sevenDay', 12),
          delta: calculateDelta(history, 'sevenDay'),
          burn: calculateBurnRate(history, 'sevenDay', 6),
          projection: projectExhaustion(
            snapshot.sevenDay.utilization,
            calculateBurnRate(history, 'sevenDay', 6).ratePctPerHour,
            snapshot.sevenDay.resetsAt
          ),
        })}
        ${heroKpiCard({
          label: 'Sonnet 7d',
          utilization: snapshot.sevenDaySonnet.utilization,
          resetsAt: snapshot.sevenDaySonnet.resetsAt,
          sparkline: buildSparkline(history, 'sevenDaySonnet', 12),
          delta: calculateDelta(history, 'sevenDaySonnet'),
          burn: calculateBurnRate(history, 'sevenDaySonnet', 6),
          projection: projectExhaustion(
            snapshot.sevenDaySonnet.utilization,
            calculateBurnRate(history, 'sevenDaySonnet', 6).ratePctPerHour,
            snapshot.sevenDaySonnet.resetsAt
          ),
          accentColor: COLOR.sonnet,
        })}
        ${creditsCardHtml(snapshot, history)}
      `
    : `<div class="gauges-empty">Sin datos de uso disponibles. Recopilando...</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="60">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>LLM Usage Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background:
        radial-gradient(ellipse 80% 60% at 20% 0%, ${COLOR.accent}15 0%, transparent 60%),
        radial-gradient(ellipse 80% 60% at 100% 100%, ${COLOR.opus}12 0%, transparent 60%),
        ${COLOR.bg};
      color: ${COLOR.fg};
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      min-height: 100vh;
      padding: 28px 22px 18px;
      font-feature-settings: "cv02", "cv03", "cv04", "cv11";
      -webkit-font-smoothing: antialiased;
    }
    .container { max-width: 1240px; margin: 0 auto; }

    /* ---------- Header ---------- */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
      margin-bottom: 22px;
    }
    .header-left { display: flex; flex-direction: column; gap: 6px; }
    .header h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .live-badge {
      background: linear-gradient(135deg, ${COLOR.ok}, ${COLOR.ok}cc);
      color: ${COLOR.bg};
      font-size: 9px;
      padding: 3px 9px;
      border-radius: 999px;
      font-weight: 800;
      letter-spacing: 0.1em;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      box-shadow: 0 2px 12px ${COLOR.ok}44;
    }
    .live-dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: ${COLOR.bg};
      animation: pulse 2s infinite;
    }
    .plan-info { display: flex; align-items: center; gap: 10px; font-size: 12px; color: ${COLOR.muted}; }
    .plan-info .email { font-variant-numeric: tabular-nums; }
    .plan-chip {
      background: linear-gradient(135deg, ${COLOR.accent}22, ${COLOR.accent}11);
      border: 1px solid ${COLOR.accent}55;
      color: ${COLOR.accent};
      padding: 3px 11px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    /* Burn pill grande del header */
    .burn-pill {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 10px 18px;
      border-radius: 14px;
      background: linear-gradient(135deg, ${COLOR.card}aa, ${COLOR.card}55);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid ${COLOR.cardBorder};
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    }
    .burn-icon { font-size: 20px; line-height: 1; filter: drop-shadow(0 0 6px ${COLOR.warnStrong}88); }
    .burn-text { display: flex; flex-direction: column; line-height: 1.15; }
    .burn-rate { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .burn-sub { font-size: 10px; color: ${COLOR.mutedDim}; text-transform: lowercase; }

    /* ---------- Hero KPI cards ---------- */
    .gauges-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }
    .gauges-empty {
      grid-column: 1 / -1;
      background: ${COLOR.card}66;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid ${COLOR.cardBorder};
      border-radius: 14px;
      padding: 36px;
      text-align: center;
      color: ${COLOR.mutedDim};
      font-style: italic;
    }
    .hero-card {
      background: linear-gradient(135deg, ${COLOR.card}99 0%, ${COLOR.card}55 100%);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(205,214,244,0.08);
      border-radius: 16px;
      padding: 16px 16px 14px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      gap: 10px;
      position: relative;
      overflow: hidden;
    }
    .hero-card::before {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(135deg, transparent 60%, rgba(255,255,255,0.025));
      pointer-events: none;
    }
    .hero-card:hover {
      border-color: ${COLOR.accent}55;
      transform: translateY(-1px);
      box-shadow: 0 8px 28px ${COLOR.accent}18;
    }
    .hero-top {
      display: flex; justify-content: space-between; align-items: center;
    }
    .hero-label { font-size: 12px; color: ${COLOR.muted}; font-weight: 600; letter-spacing: 0.01em; }
    .hero-mid {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .gauge-circle { width: 86px; height: 86px; position: relative; flex-shrink: 0; }
    .gauge-circle svg { transform: rotate(-90deg); width: 86px; height: 86px; }
    .gauge-bg { fill: none; stroke: ${COLOR.cardBorder}77; stroke-width: 8; }
    .gauge-fill {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1);
      filter: drop-shadow(0 0 4px currentColor);
    }
    .gauge-value {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1;
      letter-spacing: -0.02em;
      display: flex;
      align-items: baseline;
    }
    .gauge-pct { font-size: 22px; }
    .gauge-pct-sym { font-size: 12px; opacity: 0.7; margin-left: 1px; }
    .hero-spark { flex: 1; display: flex; justify-content: flex-end; align-items: flex-end; min-width: 0; }
    .sparkline { display: block; opacity: 0.85; }
    .hero-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: ${COLOR.mutedDim};
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.01em;
    }
    .hero-burn { color: ${COLOR.muted}; font-weight: 600; }
    .hero-projection {
      display: flex; align-items: center; gap: 6px;
      font-size: 10px;
      font-weight: 500;
      padding-top: 6px;
      border-top: 1px solid ${COLOR.cardBorder}55;
      letter-spacing: 0.01em;
    }
    .proj-dot {
      width: 6px; height: 6px; border-radius: 50%;
      box-shadow: 0 0 4px currentColor;
    }
    .delta {
      font-size: 10px; font-weight: 600;
      padding: 2px 6px; border-radius: 6px;
      font-variant-numeric: tabular-nums;
    }
    .delta-up { background: ${COLOR.error}22; color: ${COLOR.error}; }
    .delta-down { background: ${COLOR.ok}22; color: ${COLOR.ok}; }
    .delta-flat { background: ${COLOR.cardBorder}55; color: ${COLOR.mutedDim}; }

    /* ---------- Credits card variant ---------- */
    .credits-card .credits-amount {
      font-size: 26px;
      font-weight: 700;
      color: ${COLOR.ok};
      line-height: 1.1;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .credits-card .credits-amount.muted { color: ${COLOR.mutedDim}; font-size: 22px; }
    .credits-card .credits-sub { font-size: 11px; color: ${COLOR.muted}; }
    .credits-bar {
      height: 6px;
      background: ${COLOR.cardBorder}66;
      border-radius: 3px;
      overflow: hidden;
      margin-top: 4px;
    }
    .credits-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, ${COLOR.ok}, ${COLOR.warn});
      border-radius: 3px;
      transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 0 8px ${COLOR.ok}66;
    }
    .credits-card.disabled { opacity: 0.55; }

    /* ---------- Generic card ---------- */
    .card {
      background: linear-gradient(135deg, ${COLOR.card}99 0%, ${COLOR.card}55 100%);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(205,214,244,0.08);
      border-radius: 16px;
      padding: 18px 20px;
      position: relative;
    }
    .card h3 {
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 14px;
      color: ${COLOR.fg};
      display: flex; justify-content: space-between; align-items: baseline;
      letter-spacing: -0.01em;
    }
    .card-sub { font-size: 10px; color: ${COLOR.mutedDim}; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }

    /* ---------- Heatmap row ---------- */
    .heatmap-row {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }
    .heatmap-card { padding: 18px 22px 22px; }
    .hm-axis {
      position: relative;
      height: 14px;
      margin-bottom: 6px;
      font-size: 9px;
      color: ${COLOR.mutedDim};
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .hm-axis span { position: absolute; }
    .hm-grid { display: flex; flex-direction: column; gap: 3px; }
    .hm-row {
      display: grid;
      grid-template-columns: 24px repeat(24, minmax(0, 1fr));
      gap: 3px;
      align-items: center;
    }
    .hm-row-today .hm-day-label { color: ${COLOR.accent}; font-weight: 700; }
    .hm-day-label {
      font-size: 10px;
      color: ${COLOR.mutedDim};
      text-align: right;
      padding-right: 4px;
      letter-spacing: 0.02em;
    }
    .hm-cell {
      height: 14px;
      border-radius: 3px;
      cursor: default;
      transition: all 0.15s;
    }
    .hm-cell:hover { transform: scale(1.4); z-index: 1; box-shadow: 0 0 8px rgba(0,0,0,0.4); }
    .hm-empty { background: ${COLOR.cardBorder}55; opacity: 0.5; }
    .hm-now { outline: 1.5px solid ${COLOR.accent}; outline-offset: 1px; }
    .hm-legend {
      display: flex; align-items: center; gap: 8px;
      margin-top: 14px;
      font-size: 10px;
      color: ${COLOR.mutedDim};
      justify-content: flex-end;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .hm-scale { display: inline-flex; gap: 2px; }
    .hm-scale i { display: inline-block; width: 11px; height: 11px; border-radius: 2px; }

    /* ---------- Charts row ---------- */
    .charts-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }
    .stat-chips { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .stat-chip {
      display: flex; flex-direction: column;
      padding: 7px 13px;
      background: ${COLOR.bg}88;
      border: 1px solid ${COLOR.cardBorder}55;
      border-radius: 10px;
      min-width: 88px;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .stat-chip-label { font-size: 9px; color: ${COLOR.mutedDim}; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
    .stat-chip-value { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; margin-top: 2px; }

    .chart-bars {
      height: 180px;
      display: flex;
      align-items: flex-end;
      gap: 3px;
      padding-bottom: 4px;
      border-bottom: 1px solid ${COLOR.cardBorder}77;
    }
    .bar-group {
      flex: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      min-width: 6px;
      background: transparent;
    }
    .bar-stack {
      width: 100%;
      display: flex;
      flex-direction: column;
      border-radius: 4px 4px 0 0;
      overflow: hidden;
      transition: height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
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
      background: linear-gradient(180deg, ${COLOR.opus}, ${COLOR.opus}aa);
      width: 100%;
      transition: height 0.4s cubic-bezier(0.4, 0, 0.2, 1), filter 0.15s;
    }
    .bar-sonnet {
      background: linear-gradient(180deg, ${COLOR.sonnet}, ${COLOR.sonnet}aa);
      width: 100%;
      transition: height 0.4s cubic-bezier(0.4, 0, 0.2, 1), filter 0.15s;
    }
    .bar-group:hover .bar-opus,
    .bar-group:hover .bar-sonnet { filter: brightness(1.25); }
    .chart-legend-label { text-transform: uppercase; font-size: 9px; letter-spacing: 0.06em; color: ${COLOR.mutedDim}; font-weight: 600; }
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
      display: flex; gap: 18px; margin-top: 12px; font-size: 11px; color: ${COLOR.muted};
    }
    .chart-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; box-shadow: 0 0 4px currentColor; }
    .chart-empty {
      height: 180px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: ${COLOR.mutedDim};
      gap: 4px;
    }
    .chart-empty-icon { font-size: 28px; opacity: 0.4; margin-bottom: 4px; }
    .chart-empty-sub { font-size: 11px; opacity: 0.7; }

    .muted { color: ${COLOR.mutedDim}; font-style: italic; font-size: 13px; }

    /* ---------- Status bar ---------- */
    .status-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: ${COLOR.mutedDim};
      padding-top: 14px;
      border-top: 1px solid ${COLOR.cardBorder}55;
      flex-wrap: wrap;
      gap: 8px;
      letter-spacing: 0.02em;
    }
    .status-bar .live { display: flex; align-items: center; gap: 6px; }
    .pulse {
      width: 6px; height: 6px; border-radius: 50%;
      background: ${COLOR.ok};
      box-shadow: 0 0 6px ${COLOR.ok};
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* ---------- Responsive ---------- */
    @media (max-width: 1100px) {
      .gauges-row { grid-template-columns: repeat(2, 1fr); }
      .heatmap-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .gauges-row { grid-template-columns: 1fr; }
      .header { flex-direction: column; align-items: flex-start; }
      .plan-info { flex-wrap: wrap; }
      .hm-row { grid-template-columns: 22px repeat(24, minmax(0, 1fr)); }
      .hm-day-label { font-size: 9px; }
    }
  </style>
</head>
<body>
  <div class="container">
    ${headerHtml(profile, snapshot, history)}

    <div class="gauges-row">
      ${heroes}
    </div>

    <div class="heatmap-row">
      ${heatmapHtml(history)}
    </div>

    <div class="charts-row">
      <div class="card">
        <h3>
          <span>Actividad últimas 24h</span>
          <small class="card-sub">% de cuota 7d consumido por hora · Opus + Sonnet apilado</small>
        </h3>
        ${statsChipsHtml(history, snapshot)}
        ${activityChartHtml(history)}
      </div>
    </div>

    ${statusBarHtml(stats)}
  </div>
</body>
</html>`;
}
