import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../src/extension/services/database';
import type { AccountProfile, UsageSnapshot } from '../../src/extension/providers/types';

// Snapshot base reutilizable en los tests
function makeSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    provider: 'anthropic',
    timestamp: new Date().toISOString(),
    fiveHour: { utilization: 0.5, resetsAt: null },
    sevenDay: { utilization: 0.3, resetsAt: '2026-04-20T00:00:00Z' },
    sevenDaySonnet: { utilization: 0.1, resetsAt: null },
    extraUsage: { isEnabled: false, monthlyLimit: 0, usedCredits: 0, utilization: null },
    ...overrides,
  };
}

// Perfil base reutilizable
function makeProfile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    provider: 'anthropic',
    email: 'test@example.com',
    displayName: 'Test User',
    planType: 'pro',
    tier: 'standard',
    billingType: 'subscription',
    subscriptionStatus: 'active',
    subscriptionCreatedAt: '2025-01-01T00:00:00Z',
    lastFetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('DatabaseService', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    // DB en memoria — sin persistencia a disco
    db = new DatabaseService(null);
    await db.initialize();
  });

  afterEach(() => {
    db.close();
  });

  describe('insertSnapshot / getSnapshots', () => {
    it('inserta y recupera un snapshot de uso', () => {
      const snapshot = makeSnapshot();
      db.insertSnapshot(snapshot);

      const results = db.getSnapshots('anthropic', 1);

      expect(results).toHaveLength(1);
      expect(results[0].provider).toBe('anthropic');
      expect(results[0].fiveHour.utilization).toBe(0.5);
      expect(results[0].sevenDay.resetsAt).toBe('2026-04-20T00:00:00Z');
      expect(results[0].extraUsage.isEnabled).toBe(false);
      expect(results[0].extraUsage.utilization).toBeNull();
    });

    it('recupera solo snapshots dentro del rango de tiempo solicitado', () => {
      // Snapshot reciente — dentro del rango
      const recent = makeSnapshot({ timestamp: new Date().toISOString() });

      // Snapshot antiguo — fuera del rango de 1 hora
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const old = makeSnapshot({ timestamp: twoHoursAgo });

      db.insertSnapshot(recent);
      db.insertSnapshot(old);

      const results = db.getSnapshots('anthropic', 1);

      // Solo el reciente debe aparecer
      expect(results).toHaveLength(1);
      expect(results[0].timestamp).toBe(recent.timestamp);
    });

    it('retorna array vacío cuando no hay snapshots para el provider', () => {
      db.insertSnapshot(makeSnapshot({ provider: 'anthropic' }));

      const results = db.getSnapshots('openai', 24);
      expect(results).toHaveLength(0);
    });
  });

  describe('upsertProfile / getProfile', () => {
    it('inserta y recupera un perfil de cuenta', () => {
      const profile = makeProfile();
      db.upsertProfile(profile);

      const result = db.getProfile('anthropic');

      expect(result).not.toBeNull();
      expect(result!.email).toBe('test@example.com');
      expect(result!.displayName).toBe('Test User');
      expect(result!.planType).toBe('pro');
    });

    it('actualiza el perfil existente en upsert sin duplicar registros', () => {
      db.upsertProfile(makeProfile({ email: 'old@example.com' }));
      db.upsertProfile(makeProfile({ email: 'new@example.com', displayName: 'Updated User' }));

      const result = db.getProfile('anthropic');

      expect(result).not.toBeNull();
      expect(result!.email).toBe('new@example.com');
      expect(result!.displayName).toBe('Updated User');
    });

    it('retorna null cuando el provider no tiene perfil guardado', () => {
      const result = db.getProfile('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getAllSnapshots / getSnapshotCount / getStorageBytes', () => {
    it('getAllSnapshots devuelve todos los snapshots del provider sin filtrar por tiempo', () => {
      const now = new Date().toISOString();
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      db.insertSnapshot(makeSnapshot({ timestamp: now }));
      db.insertSnapshot(makeSnapshot({ timestamp: monthAgo }));
      db.insertSnapshot(makeSnapshot({ provider: 'openai', timestamp: now }));

      const anthropicAll = db.getAllSnapshots('anthropic');
      expect(anthropicAll).toHaveLength(2);

      const openaiAll = db.getAllSnapshots('openai');
      expect(openaiAll).toHaveLength(1);
    });

    it('getSnapshotCount refleja el total global de snapshots almacenados', () => {
      expect(db.getSnapshotCount()).toBe(0);

      db.insertSnapshot(makeSnapshot());
      db.insertSnapshot(makeSnapshot({ provider: 'openai' }));

      expect(db.getSnapshotCount()).toBe(2);
    });

    it('getStorageBytes retorna 0 cuando el store es en memoria', () => {
      // DB instanciada en beforeEach con dbPath=null
      db.insertSnapshot(makeSnapshot());
      expect(db.getStorageBytes()).toBe(0);
    });
  });

  describe('purgeOldSnapshots', () => {
    it('elimina snapshots más antiguos que el período de retención', () => {
      const now = new Date();
      const recentTs = now.toISOString();
      const oldTs = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 días atrás

      db.insertSnapshot(makeSnapshot({ timestamp: recentTs }));
      db.insertSnapshot(makeSnapshot({ timestamp: oldTs }));

      // Purgar snapshots con más de 7 días
      db.purgeOldSnapshots(7);

      // Solo el reciente debe sobrevivir
      const results = db.getSnapshots('anthropic', 24 * 365);
      expect(results).toHaveLength(1);
      expect(results[0].timestamp).toBe(recentTs);
    });

    it('no elimina snapshots dentro del período de retención', () => {
      db.insertSnapshot(makeSnapshot());
      db.purgeOldSnapshots(30);

      const results = db.getSnapshots('anthropic', 1);
      expect(results).toHaveLength(1);
    });
  });
});
