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
  // Ciclos de intervalo a saltar por proveedor cuando hay rate limiting
  private skipCycles: Map<string, number> = new Map();

  constructor(providers: UsageProvider[], callbacks: PollerCallbacks) {
    this.providers = providers;
    this.callbacks = callbacks;
  }

  get isRunning(): boolean {
    return this.intervalId !== null;
  }

  start(intervalMs: number): void {
    if (this.isRunning) return;
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
      // Respetar backoff: decrementar el contador y saltar si aún hay ciclos pendientes
      const skip = this.skipCycles.get(provider.id) ?? 0;
      if (skip > 0) {
        this.skipCycles.set(provider.id, skip - 1);
        continue;
      }

      try {
        const configured = await provider.isConfigured();
        if (!configured) continue;

        const snapshot = await provider.fetchUsage();
        this.consecutiveFailures.set(provider.id, 0);
        this.callbacks.onUsageUpdate(snapshot);
      } catch (err) {
        const current = this.consecutiveFailures.get(provider.id) ?? 0;
        this.consecutiveFailures.set(provider.id, current + 1);

        const error = err instanceof Error ? err : new Error(String(err));

        // Backoff exponencial para rate limiting: 2^fallos ciclos (máx 8 = ~8 min con intervalo de 60s)
        if (error.message.includes('429') || error.message.includes('rate_limit')) {
          const backoffCycles = Math.min(Math.pow(2, current), 8);
          this.skipCycles.set(provider.id, backoffCycles);
          console.warn(`[llm-usage] Rate limit en "${provider.id}", esperando ${backoffCycles} ciclos`);
        }

        this.callbacks.onError(error, provider.id);
      }
    }
  }

  getConsecutiveFailures(providerId: string): number {
    return this.consecutiveFailures.get(providerId) ?? 0;
  }
}
