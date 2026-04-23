import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import { AuthService } from './services/auth';
import { DatabaseService } from './services/database';
import { PollerService } from './services/poller';
import { AnthropicProvider } from './providers/anthropic';
import { HtmlExporter } from './services/html-exporter';
import { PanelProvider } from './webview/panel-provider';
import type { UsageSnapshot } from './providers/types';
import { formatDurationCompact } from './services/metrics-calculator';

let poller: PollerService | null = null;
let database: DatabaseService | null = null;


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
  const exporter = new HtmlExporter(storagePath);
  const panel = new PanelProvider();

  // Construye stats de almacenamiento consumidos por el status bar del dashboard
  const buildStats = () => ({
    snapshotCount: database?.getSnapshotCount() ?? 0,
    storageBytes: database?.getStorageBytes() ?? 0,
  });

  // Genera HTML con los datos actuales de la DB al momento de abrir.
  // Historia de 24h para alimentar el chart; si no hay, el panel muestra estado vacío.
  const openDashboard = () => {
    const history = database?.getSnapshots('anthropic', 24) ?? [];
    const profile = database?.getProfile('anthropic') ?? null;
    const current = history.length > 0 ? history[history.length - 1] : null;
    const html = exporter.generate(current, profile, history, buildStats());
    panel.open(html);
  };

  // Status bar — único punto de entrada visible. Click abre el panel completo.
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'llmUsage.showDashboard';
  statusBarItem.name = 'Claude Usage';
  statusBarItem.text = '$(sparkle) Claude —';
  statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
  statusBarItem.tooltip = buildTooltip(null);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const updateStatusBar = (snapshot: UsageSnapshot | null) => {
    if (!snapshot) {
      statusBarItem.text = '$(sparkle) Claude —';
      statusBarItem.tooltip = buildTooltip(null);
      statusBarItem.backgroundColor = undefined;
      return;
    }
    const session = Math.round(snapshot.fiveHour.utilization);
    const week = Math.round(snapshot.sevenDay.utilization);
    statusBarItem.text = `$(sparkle) Claude  $(flame) ${session}%  ·  $(calendar) ${week}%`;
    statusBarItem.tooltip = buildTooltip(snapshot);

    // Background cuando hay saturación; foreground prominente siempre
    const max = Math.max(session, week);
    if (max >= 95) {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (max >= 80) {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      statusBarItem.backgroundColor = undefined;
    }
  };

  context.subscriptions.push({ dispose: () => panel.dispose() });

  poller = new PollerService([anthropic], {
    onUsageUpdate: (snapshot: UsageSnapshot) => {
      database?.insertSnapshot(snapshot);

      const history = database?.getSnapshots('anthropic', 24) ?? [];
      const profile = database?.getProfile('anthropic') ?? null;
      const html = exporter.generate(snapshot, profile, history, buildStats());
      panel.update(html);

      updateStatusBar(snapshot);
    },

    onError: (error: Error, providerId: string) => {
      console.error(`[llm-usage] Error en provider "${providerId}":`, error.message);
    },
  });

  poller.start(pollingIntervalSec * 1000);

  // Poll inmediato al arrancar — sin esperar el primer intervalo
  void poller.pollOnce();

  // Perfil al arranque — actualiza panel si ya está abierto
  void anthropic.fetchProfile().then((profile) => {
    database?.upsertProfile(profile);
    const history = database?.getSnapshots('anthropic', 24) ?? [];
    const current = history.length > 0 ? history[history.length - 1] : null;
    const html = exporter.generate(current, profile, history, buildStats());
    panel.update(html);

    if (current) updateStatusBar(current);
  }).catch((err: unknown) => {
    console.warn('[llm-usage] No se pudo obtener el perfil al arranque:', err);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('llmUsage.showDashboard', openDashboard)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('llmUsage.refreshNow', () => {
      void poller?.pollOnce();
    })
  );

  const purgeInterval = setInterval(() => {
    database?.purgeOldSnapshots(30);
  }, 86_400_000);
  context.subscriptions.push({ dispose: () => clearInterval(purgeInterval) });
}

export function deactivate(): void {
  poller?.stop();
  database?.close();
}

function tooltipCountdown(resetsAt: string | null): string {
  if (!resetsAt) return '—';
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return 'reiniciando';
  return formatDurationCompact(diff);
}

function buildTooltip(snapshot: UsageSnapshot | null): vscode.MarkdownString {
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
