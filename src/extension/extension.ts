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

  // Tree view vacío — el viewsWelcome muestra el botón "Abrir Dashboard"
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('llmUsage.sidebar', {
      getTreeItem: () => new vscode.TreeItem(''),
      getChildren: () => [],
    })
  );
  context.subscriptions.push({ dispose: () => panel.dispose() });

  poller = new PollerService([anthropic], {
    onUsageUpdate: (snapshot: UsageSnapshot) => {
      database?.insertSnapshot(snapshot);

      const history = database?.getSnapshots('anthropic', 24) ?? [];
      const profile = database?.getProfile('anthropic') ?? null;
      const html = exporter.generate(snapshot, profile, history, buildStats());
      panel.update(html);
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
