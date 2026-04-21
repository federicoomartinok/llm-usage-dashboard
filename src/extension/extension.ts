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
import { SidebarProvider } from './webview/sidebar-provider';
import type { UsageSnapshot, AccountProfile, WebviewMessage } from './providers/types';

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

  // Sidebar webview — dashboard React embebido en la barra lateral
  const sidebar = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('llmUsage.sidebar', sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Status bar — visible siempre, click abre el panel completo
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'llmUsage.showDashboard';
  statusBarItem.tooltip = 'LLM Usage — click para abrir el dashboard completo';
  statusBarItem.text = '$(graph) LLM —';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const updateStatusBar = (snapshot: UsageSnapshot | null) => {
    if (!snapshot) {
      statusBarItem.text = '$(graph) LLM —';
      return;
    }
    const session = Math.round(snapshot.fiveHour.utilization);
    const week = Math.round(snapshot.sevenDay.utilization);
    statusBarItem.text = `$(flame) ${session}% · $(calendar) ${week}%`;
    // Color cuando algo está saturado
    const max = Math.max(session, week);
    if (max >= 95) {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (max >= 80) {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      statusBarItem.backgroundColor = undefined;
    }
  };

  // Manda el state inicial al sidebar cuando pide 'init', y responde a refresh-now
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      // Re-render del sidebar al cambiar tema (no es crítico, pero evita parpadeo)
    })
  );

  const sendStateToSidebar = (profile: AccountProfile | null) => {
    const history = database?.getSnapshots('anthropic', 24) ?? [];
    const current = history.length > 0 ? history[history.length - 1] : null;
    sidebar.postMessage({
      type: 'state',
      current,
      history,
      profile,
    });
  };

  // Suscripción a mensajes del sidebar — se cablea cuando el view se resuelve
  const wireSidebarMessages = () => {
    const disposable = sidebar.onDidReceiveMessage((msg: WebviewMessage) => {
      switch (msg.type) {
        case 'init': {
          const profile = database?.getProfile('anthropic') ?? null;
          sendStateToSidebar(profile);
          break;
        }
        case 'refresh-now':
          void poller?.pollOnce();
          break;
        case 'request-history': {
          const history = database?.getSnapshots('anthropic', msg.hours) ?? [];
          const profile = database?.getProfile('anthropic') ?? null;
          const current = history.length > 0 ? history[history.length - 1] : null;
          sidebar.postMessage({ type: 'state', current, history, profile });
          break;
        }
      }
    });
    if (disposable) context.subscriptions.push(disposable);
  };

  // El view tarda un tick en resolverse — reintentamos hasta que esté listo
  const wireInterval = setInterval(() => {
    if (sidebar.isVisible) {
      wireSidebarMessages();
      clearInterval(wireInterval);
    }
  }, 500);
  context.subscriptions.push({ dispose: () => clearInterval(wireInterval) });

  context.subscriptions.push({ dispose: () => panel.dispose() });

  poller = new PollerService([anthropic], {
    onUsageUpdate: (snapshot: UsageSnapshot) => {
      database?.insertSnapshot(snapshot);

      const history = database?.getSnapshots('anthropic', 24) ?? [];
      const profile = database?.getProfile('anthropic') ?? null;
      const html = exporter.generate(snapshot, profile, history, buildStats());
      panel.update(html);

      // Push al sidebar webview y al status bar
      sidebar.postMessage({ type: 'usage-update', data: snapshot });
      updateStatusBar(snapshot);
    },

    onError: (error: Error, providerId: string) => {
      console.error(`[llm-usage] Error en provider "${providerId}":`, error.message);
      sidebar.postMessage({ type: 'error', message: error.message });
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

    // Sincroniza sidebar y status bar
    sidebar.postMessage({ type: 'profile-update', data: profile });
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
