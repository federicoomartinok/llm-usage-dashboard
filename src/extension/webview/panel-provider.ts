import * as vscode from 'vscode';
import type { WebviewMessage } from '../providers/types';

// Panel que muestra el dashboard en una pestaña del IDE.
// Habilita scripts (con nonce en CSP) para soportar tabs interactivas.
export class PanelProvider {
  private panel: vscode.WebviewPanel | null = null;
  private lastHtml = '';
  private messageHandler: ((msg: WebviewMessage) => void) | null = null;

  open(html: string): void {
    if (this.panel) {
      this.panel.webview.html = html;
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'llmUsage.dashboard',
      'LLM Usage Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.lastHtml = html;
    this.panel.webview.html = html;

    this.panel.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      this.messageHandler?.(msg);
    });

    this.panel.onDidDispose(() => {
      this.panel = null;
    });
  }

  update(html: string): void {
    this.lastHtml = html;
    if (this.panel) {
      this.panel.webview.html = html;
    }
  }

  // Registra el callback que recibe mensajes desde el webview (clicks en tabs, refresh, etc.)
  onMessage(handler: (msg: WebviewMessage) => void): void {
    this.messageHandler = handler;
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
