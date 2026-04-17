import * as vscode from 'vscode';

// Panel que muestra el dashboard en una pestaña del IDE.
// No usa asWebviewUri — el HTML es 100% autocontenido.
export class PanelProvider {
  private panel: vscode.WebviewPanel | null = null;
  private lastHtml = '';

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
      { enableScripts: false, retainContextWhenHidden: true }
    );

    this.lastHtml = html;
    this.panel.webview.html = html;

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

  get isOpen(): boolean {
    return this.panel !== null;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
