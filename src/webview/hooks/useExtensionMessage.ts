import { useState, useEffect, useCallback } from 'react';
import type { UsageSnapshot, AccountProfile, ExtensionMessage, WebviewMessage } from '../../extension/providers/types';

// Tipado mínimo de la API de VS Code expuesta en webviews
declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewMessage): void;
};

interface ExtensionState {
  current: UsageSnapshot | null;
  history: UsageSnapshot[];
  profile: AccountProfile | null;
  lastUpdated: Date | null;
  error: string | null;
}

const vscode = acquireVsCodeApi();

export function useExtensionMessage() {
  const [state, setState] = useState<ExtensionState>({
    current: null,
    history: [],
    profile: null,
    lastUpdated: null,
    error: null,
  });

  useEffect(() => {
    function handleMessage(event: MessageEvent<ExtensionMessage>) {
      const msg = event.data;

      switch (msg.type) {
        case 'state':
          setState((prev) => ({
            ...prev,
            current: msg.current,
            history: msg.history,
            profile: msg.profile,
            lastUpdated: new Date(),
            error: null,
          }));
          break;

        case 'usage-update':
          setState((prev) => ({
            ...prev,
            current: msg.data,
            lastUpdated: new Date(),
            error: null,
          }));
          break;

        case 'profile-update':
          setState((prev) => ({
            ...prev,
            profile: msg.data,
          }));
          break;

        case 'error':
          setState((prev) => ({
            ...prev,
            error: msg.message,
          }));
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    // Solicitar estado inicial al montar
    vscode.postMessage({ type: 'init' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const refreshNow = useCallback(() => {
    vscode.postMessage({ type: 'refresh-now' });
  }, []);

  const requestHistory = useCallback((hours: number) => {
    vscode.postMessage({ type: 'request-history', hours });
  }, []);

  return { ...state, refreshNow, requestHistory };
}
