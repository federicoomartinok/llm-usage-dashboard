import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PollerService } from '../../src/extension/services/poller';
import type { UsageProvider, UsageSnapshot } from '../../src/extension/providers/types';

// Vacía microtareas pendientes usando advanceTimersByTimeAsync(0) de Vitest
// (setTimeout(0) queda bloqueado por fake timers — esta variante es segura)
const flushPromises = () => vi.advanceTimersByTimeAsync(0);

// Snapshot mínimo válido para tests
function makeSnapshot(provider = 'test-provider'): UsageSnapshot {
  return {
    provider,
    timestamp: new Date().toISOString(),
    fiveHour: { utilization: 0.1, resetsAt: null },
    sevenDay: { utilization: 0.2, resetsAt: null },
    sevenDaySonnet: { utilization: 0.15, resetsAt: null },
    extraUsage: { isEnabled: false, monthlyLimit: 0, usedCredits: 0, utilization: null },
  };
}

// Crea un provider mock configurable con valores por defecto
function makeProvider(overrides: Partial<{
  id: string;
  configured: boolean;
  snapshot: UsageSnapshot;
  fetchError: Error;
}>  = {}): UsageProvider {
  const id = overrides.id ?? 'test-provider';
  return {
    id,
    name: `Provider ${id}`,
    isConfigured: vi.fn().mockResolvedValue(overrides.configured ?? true),
    fetchUsage: overrides.fetchError
      ? vi.fn().mockRejectedValue(overrides.fetchError)
      : vi.fn().mockResolvedValue(overrides.snapshot ?? makeSnapshot(id)),
    fetchProfile: vi.fn().mockResolvedValue({}),
  } as unknown as UsageProvider;
}

describe('PollerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('pollOnce', () => {
    it('invoca onUsageUpdate con el snapshot del provider cuando está configurado', async () => {
      const snapshot = makeSnapshot();
      const provider = makeProvider({ snapshot });
      const onUsageUpdate = vi.fn();
      const onError = vi.fn();

      const poller = new PollerService([provider], { onUsageUpdate, onError });
      await poller.pollOnce();

      expect(onUsageUpdate).toHaveBeenCalledOnce();
      expect(onUsageUpdate).toHaveBeenCalledWith(snapshot);
      expect(onError).not.toHaveBeenCalled();
    });

    it('no invoca onUsageUpdate cuando el provider no está configurado', async () => {
      const provider = makeProvider({ configured: false });
      const onUsageUpdate = vi.fn();
      const onError = vi.fn();

      const poller = new PollerService([provider], { onUsageUpdate, onError });
      await poller.pollOnce();

      expect(onUsageUpdate).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('invoca onError con el error y el providerId cuando fetchUsage falla', async () => {
      const fetchError = new Error('red caída');
      const provider = makeProvider({ fetchError });
      const onUsageUpdate = vi.fn();
      const onError = vi.fn();

      const poller = new PollerService([provider], { onUsageUpdate, onError });
      await poller.pollOnce();

      expect(onUsageUpdate).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(fetchError, 'test-provider');
    });

    it('procesa múltiples providers de forma independiente', async () => {
      const snap1 = makeSnapshot('p1');
      const snap2 = makeSnapshot('p2');
      const p1 = makeProvider({ id: 'p1', snapshot: snap1 });
      const p2 = makeProvider({ id: 'p2', snapshot: snap2 });
      const onUsageUpdate = vi.fn();
      const onError = vi.fn();

      const poller = new PollerService([p1, p2], { onUsageUpdate, onError });
      await poller.pollOnce();

      expect(onUsageUpdate).toHaveBeenCalledTimes(2);
      expect(onUsageUpdate).toHaveBeenCalledWith(snap1);
      expect(onUsageUpdate).toHaveBeenCalledWith(snap2);
    });

    it('continúa con el siguiente provider aunque uno falle', async () => {
      const snap2 = makeSnapshot('p2');
      const p1 = makeProvider({ id: 'p1', fetchError: new Error('fallo') });
      const p2 = makeProvider({ id: 'p2', snapshot: snap2 });
      const onUsageUpdate = vi.fn();
      const onError = vi.fn();

      const poller = new PollerService([p1, p2], { onUsageUpdate, onError });
      await poller.pollOnce();

      expect(onError).toHaveBeenCalledOnce();
      expect(onUsageUpdate).toHaveBeenCalledOnce();
      expect(onUsageUpdate).toHaveBeenCalledWith(snap2);
    });
  });

  describe('consecutiveFailures', () => {
    it('retorna 0 para un provider sin fallos registrados', () => {
      const poller = new PollerService([], { onUsageUpdate: vi.fn(), onError: vi.fn() });
      expect(poller.getConsecutiveFailures('cualquier-id')).toBe(0);
    });

    it('incrementa el contador de fallos consecutivos en cada error', async () => {
      const provider = makeProvider({ fetchError: new Error('fallo') });
      const poller = new PollerService([provider], { onUsageUpdate: vi.fn(), onError: vi.fn() });

      await poller.pollOnce();
      expect(poller.getConsecutiveFailures('test-provider')).toBe(1);

      await poller.pollOnce();
      expect(poller.getConsecutiveFailures('test-provider')).toBe(2);
    });

    it('resetea el contador a 0 después de un poll exitoso', async () => {
      const fetchError = new Error('fallo temporal');
      const fetchUsage = vi.fn()
        .mockRejectedValueOnce(fetchError)
        .mockRejectedValueOnce(fetchError)
        .mockResolvedValue(makeSnapshot());

      const provider: UsageProvider = {
        id: 'test-provider',
        name: 'Test',
        isConfigured: vi.fn().mockResolvedValue(true),
        fetchUsage,
        fetchProfile: vi.fn(),
      } as unknown as UsageProvider;

      const poller = new PollerService([provider], { onUsageUpdate: vi.fn(), onError: vi.fn() });

      await poller.pollOnce();
      await poller.pollOnce();
      expect(poller.getConsecutiveFailures('test-provider')).toBe(2);

      await poller.pollOnce();
      expect(poller.getConsecutiveFailures('test-provider')).toBe(0);
    });
  });

  describe('start / stop / isRunning', () => {
    it('isRunning es false antes de start', () => {
      const poller = new PollerService([], { onUsageUpdate: vi.fn(), onError: vi.fn() });
      expect(poller.isRunning).toBe(false);
    });

    it('isRunning es true después de start y false después de stop', () => {
      const poller = new PollerService([], { onUsageUpdate: vi.fn(), onError: vi.fn() });
      poller.start(5000);
      expect(poller.isRunning).toBe(true);

      poller.stop();
      expect(poller.isRunning).toBe(false);
    });

    it('llama a pollOnce inmediatamente al arrancar', async () => {
      const provider = makeProvider();
      const onUsageUpdate = vi.fn();
      const poller = new PollerService([provider], { onUsageUpdate, onError: vi.fn() });

      poller.start(60_000);
      // setTimeout(0) deja que la cadena async de pollOnce resuelva completamente
      await flushPromises();

      expect(onUsageUpdate).toHaveBeenCalledOnce();
      poller.stop();
    });

    it('llama a pollOnce en cada tick del intervalo', async () => {
      const provider = makeProvider();
      const onUsageUpdate = vi.fn();
      const poller = new PollerService([provider], { onUsageUpdate, onError: vi.fn() });

      poller.start(5_000);
      await flushPromises(); // poll inicial

      vi.advanceTimersByTime(5_000);
      await flushPromises(); // segundo poll

      vi.advanceTimersByTime(5_000);
      await flushPromises(); // tercer poll

      expect(onUsageUpdate).toHaveBeenCalledTimes(3);
      poller.stop();
    });

    it('no arranca un segundo intervalo si start se llama dos veces', async () => {
      const provider = makeProvider();
      const onUsageUpdate = vi.fn();
      const poller = new PollerService([provider], { onUsageUpdate, onError: vi.fn() });

      poller.start(5_000);
      poller.start(5_000); // segunda llamada debe ignorarse
      await flushPromises();

      // Solo un poll inmediato, no dos
      expect(onUsageUpdate).toHaveBeenCalledOnce();
      poller.stop();
    });

    it('stop es seguro si no está corriendo', () => {
      const poller = new PollerService([], { onUsageUpdate: vi.fn(), onError: vi.fn() });
      expect(() => poller.stop()).not.toThrow();
    });
  });
});
