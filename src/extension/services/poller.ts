import type { UsageProvider, UsageSnapshot } from '../providers/types';

export interface PollerCallbacks {
  onUsageUpdate: (snapshot: UsageSnapshot) => void;
  onError: (error: Error, providerId: string) => void;
}

export class PollerService {
  private providers: UsageProvider[];
  private callbacks: PollerCallbacks;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures: Map<string, number> = new Map();

  constructor(providers: UsageProvider[], callbacks: PollerCallbacks) {
    this.providers = providers;
    this.callbacks = callbacks;
  }

  get isRunning(): boolean {
    return this.intervalId !== null;
  }

  start(intervalMs: number): void {
    // Evitar doble arranque si ya está corriendo
    if (this.isRunning) return;

    void this.pollOnce();
    this.intervalId = setInterval(() => void this.pollOnce(), intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async pollOnce(): Promise<void> {
    for (const provider of this.providers) {
      try {
        const configured = await provider.isConfigured();
        if (!configured) continue;

        const snapshot = await provider.fetchUsage();
        this.consecutiveFailures.set(provider.id, 0);
        this.callbacks.onUsageUpdate(snapshot);
      } catch (err) {
        const current = this.consecutiveFailures.get(provider.id) ?? 0;
        this.consecutiveFailures.set(provider.id, current + 1);
        this.callbacks.onError(err instanceof Error ? err : new Error(String(err)), provider.id);
      }
    }
  }

  getConsecutiveFailures(providerId: string): number {
    return this.consecutiveFailures.get(providerId) ?? 0;
  }
}
