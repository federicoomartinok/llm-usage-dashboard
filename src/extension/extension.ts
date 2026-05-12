import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import { AuthService } from './services/auth';
import { DatabaseService } from './services/database';
import { PollerService } from './services/poller';
import { AnthropicProvider } from './providers/anthropic';
import { CodexProvider } from './providers/codex';
import { HtmlExporter } from './services/html-exporter';
import { PanelProvider } from './webview/panel-provider';
import type { UsageSnapshot, CodexSnapshot, ProviderId } from './providers/types';
import { formatDurationCompact } from './services/metrics-calculator';

let poller: PollerService | null = null;
let database: DatabaseService | null = null;
let codexInterval: ReturnType<typeof setInterval> | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('llmUsage');
  const pollingIntervalSec: number = config.get('pollingIntervalSeconds', 60);
  const betaHeader: string = config.get('anthropicBetaHeader', 'oauth-2025-04-20');

  const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
  const auth = new AuthService(credentialsPath);

  const storagePath = context.globalStorageUri.fsPath;
  fs.mkdirSync(storagePath, { recursive: true });

  const dbPath = path.join(storagePath, 'usage.json');
  database = new DatabaseService(dbPath);
  await database.initialize();

  const anthropic = new AnthropicProvider(auth, betaHeader);
  const codex = new CodexProvider();
  const exporter = new HtmlExporter(storagePath);
  const panel = new PanelProvider();

  // Active provider persistido en workspaceState — sobrevive reload window
  let activeProvider: ProviderId =
    (context.workspaceState.get('activeProvider') as ProviderId | undefined) ?? 'anthropic';

  const buildStats = () => ({
    snapshotCount:
      (database?.getSnapshotCount() ?? 0) + (database?.getCodexSnapshotCount() ?? 0),
    storageBytes: database?.getStorageBytes() ?? 0,
  });

  const buildExporterInput = async () => ({
    activeProvider,
    anthropic: {
      current: (database?.getSnapshots('anthropic', 24) ?? []).at(-1) ?? null,
      profile: database?.getProfile('anthropic') ?? null,
      history: database?.getSnapshots('anthropic', 24) ?? [],
      isConfigured: await anthropic.isConfigured(),
    },
    codex: {
      current: (database?.getCodexSnapshots(24) ?? []).at(-1) ?? null,
      profile: database?.getCodexProfile() ?? null,
      history: database?.getCodexSnapshots(24) ?? [],
      isConfigured: await codex.isConfigured(),
    },
    stats: buildStats(),
  });

  const regeneratePanel = async () => {
    const html = exporter.generate(await buildExporterInput());
    panel.update(html);
  };

  const openDashboard = async () => {
    const html = exporter.generate(await buildExporterInput());
    panel.open(html);
  };

  // Status bar — único punto de entrada visible. Click abre el panel completo.
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'llmUsage.showDashboard';
  statusBarItem.name = 'LLM Usage';
  statusBarItem.text = '$(sparkle) Claude —';
  statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
  statusBarItem.tooltip = buildTooltipAnthropic(null);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Refresca el status bar según el provider activo (lee del DB)
  const refreshStatusBar = () => {
    if (activeProvider === 'anthropic') {
      const snap = (database?.getSnapshots('anthropic', 24) ?? []).at(-1) ?? null;
      updateStatusBarAnthropic(statusBarItem, snap);
    } else {
      const snap = (database?.getCodexSnapshots(24) ?? []).at(-1) ?? null;
      updateStatusBarCodex(statusBarItem, snap);
    }
  };

  context.subscriptions.push({ dispose: () => panel.dispose() });

  // ============== Anthropic poll ==============
  let lastPollAtAnthropic = 0;

  poller = new PollerService([anthropic], {
    onUsageUpdate: (snapshot: UsageSnapshot) => {
      lastPollAtAnthropic = Date.now();
      database?.insertSnapshot(snapshot);
      void regeneratePanel();
      if (activeProvider === 'anthropic') {
        updateStatusBarAnthropic(statusBarItem, snapshot);
      }
    },
    onError: (error: Error, providerId: string) => {
      lastPollAtAnthropic = Date.now();
      console.error(`[llm-usage] Error en provider "${providerId}":`, error.message);
    },
  });

  poller.start(pollingIntervalSec * 1000);
  void poller.pollOnce();

  // ============== Codex poll ==============
  let lastPollAtCodex = 0;

  const codexPoll = async () => {
    if (!(await codex.isConfigured())) return;
    lastPollAtCodex = Date.now();
    try {
      const snapshot = await codex.fetchUsage();
      database?.insertCodexSnapshot(snapshot);
      void regeneratePanel();
      if (activeProvider === 'codex') {
        updateStatusBarCodex(statusBarItem, snapshot);
      }
    } catch (err) {
      console.error(
        '[llm-usage] Codex error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  codexInterval = setInterval(() => void codexPoll(), pollingIntervalSec * 1000);
  void codexPoll();

  // Watchdog: cuando la ventana recupera foco, repolea ambos providers si dormidos
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) return;
      if (Date.now() - lastPollAtAnthropic > 90_000) void poller?.pollOnce();
      if (Date.now() - lastPollAtCodex > 90_000) void codexPoll();
    })
  );

  // Perfiles al arranque
  void anthropic
    .fetchProfile()
    .then((profile) => {
      database?.upsertProfile(profile);
      void regeneratePanel();
      refreshStatusBar();
    })
    .catch((err: unknown) => {
      console.warn('[llm-usage] No se pudo obtener perfil Anthropic:', err);
    });

  void codex.isConfigured().then(async (cfg) => {
    if (!cfg) return;
    try {
      const profile = await codex.fetchProfile();
      database?.upsertCodexProfile(profile);
      void regeneratePanel();
    } catch (err) {
      console.warn('[llm-usage] No se pudo obtener perfil Codex:', err);
    }
  });

  // Mensajes desde el webview (clicks en tabs, refresh, etc.)
  panel.onMessage((msg) => {
    if (msg.type === 'set-active-provider') {
      activeProvider = msg.provider;
      void context.workspaceState.update('activeProvider', activeProvider);
      refreshStatusBar();
    } else if (msg.type === 'refresh-now') {
      void poller?.pollOnce();
      void codexPoll();
    }
  });

  // Comandos
  context.subscriptions.push(
    vscode.commands.registerCommand('llmUsage.showDashboard', () => void openDashboard())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('llmUsage.refreshNow', () => {
      void poller?.pollOnce();
      void codexPoll();
    })
  );

  const purgeInterval = setInterval(() => {
    database?.purgeOldSnapshots(30);
  }, 86_400_000);
  context.subscriptions.push({ dispose: () => clearInterval(purgeInterval) });
}

export function deactivate(): void {
  poller?.stop();
  if (codexInterval !== null) clearInterval(codexInterval);
  database?.close();
}

// ============================================================
// Status bar helpers
// ============================================================

function updateStatusBarAnthropic(
  item: vscode.StatusBarItem,
  snapshot: UsageSnapshot | null
): void {
  if (!snapshot) {
    item.text = '$(sparkle) Claude —';
    item.tooltip = buildTooltipAnthropic(null);
    item.backgroundColor = undefined;
    return;
  }
  const session = Math.round(snapshot.fiveHour.utilization);
  const week = Math.round(snapshot.sevenDay.utilization);
  item.text = `$(sparkle) Claude  $(flame) ${session}%  ·  $(calendar) ${week}%`;
  item.tooltip = buildTooltipAnthropic(snapshot);
  applyBgFromMax(item, Math.max(session, week));
}

function updateStatusBarCodex(
  item: vscode.StatusBarItem,
  snapshot: CodexSnapshot | null
): void {
  if (!snapshot) {
    item.text = '$(zap) Codex —';
    item.tooltip = buildTooltipCodex(null);
    item.backgroundColor = undefined;
    return;
  }
  const primary = Math.round(snapshot.primaryWindow.usedPercent);
  const secondary = Math.round(snapshot.secondaryWindow.usedPercent);
  item.text = `$(zap) Codex  $(flame) ${primary}%  ·  $(calendar) ${secondary}%`;
  item.tooltip = buildTooltipCodex(snapshot);
  applyBgFromMax(item, Math.max(primary, secondary));
}

function applyBgFromMax(item: vscode.StatusBarItem, max: number): void {
  if (max >= 95) {
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (max >= 80) {
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    item.backgroundColor = undefined;
  }
}

function tooltipCountdown(resetsAt: string | null): string {
  if (!resetsAt) return '—';
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return 'reiniciando';
  return formatDurationCompact(diff);
}

function buildTooltipAnthropic(snapshot: UsageSnapshot | null): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true);
  md.isTrusted = true;
  md.supportThemeIcons = true;

  if (!snapshot) {
    md.appendMarkdown('### $(sparkle) Claude Usage\n\n');
    md.appendMarkdown('_Esperando primer poll..._\n\n');
    md.appendMarkdown('Click para abrir el dashboard completo.');
    return md;
  }

  const session = snapshot.fiveHour.utilization.toFixed(1);
  const week = snapshot.sevenDay.utilization.toFixed(1);
  const sonnet = snapshot.sevenDaySonnet.utilization.toFixed(1);
  const credits = snapshot.extraUsage.usedCredits.toFixed(2);
  const limit = snapshot.extraUsage.monthlyLimit.toFixed(2);
  const sessionReset = tooltipCountdown(snapshot.fiveHour.resetsAt);
  const weekReset = tooltipCountdown(snapshot.sevenDay.resetsAt);

  md.appendMarkdown('### $(sparkle) Claude Usage\n\n');
  md.appendMarkdown('| Ventana | Uso | Reset |\n|---|---:|---:|\n');
  md.appendMarkdown(`| $(flame) Sesión 5h | **${session}%** | ${sessionReset} |\n`);
  md.appendMarkdown(`| $(calendar) Semanal 7d | **${week}%** | ${weekReset} |\n`);
  md.appendMarkdown(`| $(star) Sonnet 7d | **${sonnet}%** | — |\n`);
  md.appendMarkdown(`| $(credit-card) Créditos extra | **$${credits}** / $${limit} | — |\n`);
  md.appendMarkdown('\n_Click para abrir el dashboard completo._');
  return md;
}

function buildTooltipCodex(snapshot: CodexSnapshot | null): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true);
  md.isTrusted = true;
  md.supportThemeIcons = true;

  if (!snapshot) {
    md.appendMarkdown('### $(zap) Codex Usage\n\n');
    md.appendMarkdown('_Sin datos de Codex._\n');
    md.appendMarkdown('_Verificá que `~/.codex/auth.json` exista (login con `codex login`)._\n\n');
    md.appendMarkdown('Click para abrir el dashboard completo.');
    return md;
  }

  const primary = snapshot.primaryWindow.usedPercent.toFixed(1);
  const secondary = snapshot.secondaryWindow.usedPercent.toFixed(1);
  const credits = snapshot.credits.used.toFixed(2);
  const limit = snapshot.credits.limit.toFixed(2);
  const primReset = tooltipCountdown(snapshot.primaryWindow.resetsAt);
  const secReset = tooltipCountdown(snapshot.secondaryWindow.resetsAt);

  md.appendMarkdown(`### $(zap) Codex · ${snapshot.planType}\n\n`);
  md.appendMarkdown('| Ventana | Uso | Reset |\n|---|---:|---:|\n');
  md.appendMarkdown(`| $(flame) Primary | **${primary}%** | ${primReset} |\n`);
  md.appendMarkdown(`| $(calendar) Secondary | **${secondary}%** | ${secReset} |\n`);
  md.appendMarkdown(`| $(credit-card) Créditos | **$${credits}** / $${limit} | — |\n`);
  md.appendMarkdown('\n_Click para abrir el dashboard completo._');
  return md;
}
