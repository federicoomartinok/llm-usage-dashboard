import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import { AuthService } from './services/auth';
import { DatabaseService } from './services/database';
import { PollerService } from './services/poller';
import { evaluateAlerts, formatResetTime } from './services/alerts';
import type { AlertThresholds } from './services/alerts';
import { AnthropicProvider } from './providers/anthropic';
import type { UsageSnapshot } from './providers/types';

// Importación diferida — sidebar-provider puede no existir aún en el mismo build
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SidebarProvider } = require('./webview/sidebar-provider') as typeof import('./webview/sidebar-provider');

let poller: PollerService | null = null;
let database: DatabaseService | null = null;

// Umbral mínimo de incremento para disparar una nueva alerta y evitar spam
const ALERT_RESEND_MIN_DELTA = 0.05;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 1. Leer configuración
  const config = vscode.workspace.getConfiguration('llmUsage');
  const pollingIntervalSec: number = config.get('pollingIntervalSeconds', 60);
  const warnThreshold: number = config.get('alertThresholdWarning', 80);
  const critThreshold: number = config.get('alertThresholdCritical', 95);
  const betaHeader: string = config.get('anthropicBetaHeader', 'oauth-2025-04-20');

  const thresholds: AlertThresholds = {
    warningThreshold: warnThreshold,
    criticalThreshold: critThreshold,
  };

  // 2. AuthService apuntando a ~/.claude/.credentials.json
  const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
  const auth = new AuthService(credentialsPath);

  // 3. DatabaseService en el directorio de almacenamiento global de la extensión
  const storagePath = context.globalStorageUri.fsPath;
  fs.mkdirSync(storagePath, { recursive: true });
  const dbPath = path.join(storagePath, 'usage.db');
  database = new DatabaseService(dbPath);
  await database.initialize();

  // 4. Proveedor Anthropic
  const anthropic = new AnthropicProvider(auth, betaHeader);

  // 5. Registrar SidebarProvider como WebviewViewProvider
  const sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('llmUsage.sidebar', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Mapa de última utilización alertada por métrica, para evitar spam
  const lastAlertedUtilization = new Map<string, number>();

  // 6. PollerService con callbacks
  poller = new PollerService([anthropic], {
    onUsageUpdate: (snapshot: UsageSnapshot) => {
      // Persistir snapshot
      database?.insertSnapshot(snapshot);

      // Enviar actualización al webview
      sidebarProvider.postMessage({ type: 'usage-update', data: snapshot });

      // Evaluar alertas y notificar solo si el incremento es suficiente
      const alerts = evaluateAlerts(snapshot, thresholds);
      for (const alert of alerts) {
        const key = `${snapshot.provider}:${alert.metric}`;
        const lastUtilization = lastAlertedUtilization.get(key) ?? 0;

        if (alert.utilization - lastUtilization >= ALERT_RESEND_MIN_DELTA) {
          lastAlertedUtilization.set(key, alert.utilization);

          const resetInfo = alert.resetsAt
            ? ` — reset en ${formatResetTime(alert.resetsAt)}`
            : '';

          const message = `LLM Usage: ${alert.metric} al ${Math.round(alert.utilization * 100)}%${resetInfo}`;

          if (alert.level === 'critical') {
            void vscode.window.showErrorMessage(message);
          } else {
            void vscode.window.showWarningMessage(message);
          }
        }
      }
    },

    onError: (error: Error, providerId: string) => {
      console.error(`[llm-usage] Error en provider "${providerId}":`, error.message);

      // Notificar al webview del error
      sidebarProvider.postMessage({
        type: 'error',
        message: error.message,
      });

      // Advertencia al usuario después de 3 fallos consecutivos
      const failures = poller?.getConsecutiveFailures(providerId) ?? 0;
      if (failures >= 3) {
        void vscode.window.showWarningMessage(
          `LLM Usage: No se pudo obtener datos de ${providerId} (${failures} fallos consecutivos). ${error.message}`
        );
      }
    },
  });

  // 7. Iniciar poller
  poller.start(pollingIntervalSec * 1000);

  // 8. Obtener perfil al arranque (fire and forget)
  void anthropic.fetchProfile().then((profile) => {
    database?.upsertProfile(profile);
    sidebarProvider.postMessage({ type: 'profile-update', data: profile });
  }).catch((err: unknown) => {
    console.warn('[llm-usage] No se pudo obtener el perfil al arranque:', err);
  });

  // 9. Registrar comandos
  context.subscriptions.push(
    vscode.commands.registerCommand('llmUsage.showDashboard', () => {
      void vscode.commands.executeCommand('llmUsage.sidebar.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('llmUsage.refreshNow', () => {
      void poller?.pollOnce();
    })
  );

  // 10. Purga diaria de snapshots antiguos (retención 30 días)
  const RETENTION_DAYS = 30;
  const PURGE_INTERVAL_MS = 86_400_000;
  const purgeInterval = setInterval(() => {
    database?.purgeOldSnapshots(RETENTION_DAYS);
  }, PURGE_INTERVAL_MS);

  context.subscriptions.push({
    dispose: () => clearInterval(purgeInterval),
  });

  // 11. Escuchar mensajes del webview una vez que la vista esté lista
  //     Se usa un intervalo corto hasta que onDidReceiveMessage esté disponible
  const listenerSetupInterval = setInterval(() => {
    if (typeof sidebarProvider.onDidReceiveMessage !== 'function') return;

    clearInterval(listenerSetupInterval);

    sidebarProvider.onDidReceiveMessage(async (message: { type: string; hours?: number }) => {
      switch (message.type) {
        case 'init': {
          // Enviar estado completo inicial
          const history = database?.getSnapshots('anthropic', 24) ?? [];
          const profile = database?.getProfile('anthropic') ?? null;
          const current = history.length > 0 ? history[history.length - 1] : null;
          sidebarProvider.postMessage({ type: 'state', current, history, profile });
          break;
        }

        case 'request-history': {
          const hours = message.hours ?? 24;
          const history = database?.getSnapshots('anthropic', hours) ?? [];
          const profile = database?.getProfile('anthropic') ?? null;
          const current = history.length > 0 ? history[history.length - 1] : null;
          sidebarProvider.postMessage({ type: 'state', current, history, profile });
          break;
        }

        case 'refresh-now': {
          await poller?.pollOnce();
          break;
        }
      }
    });
  }, 500);

  context.subscriptions.push({
    dispose: () => clearInterval(listenerSetupInterval),
  });
}

export function deactivate(): void {
  poller?.stop();
  database?.close();
}
