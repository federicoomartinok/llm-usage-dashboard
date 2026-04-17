import { readFileSync, statSync, writeFileSync } from 'fs';
import type { AccountProfile, UsageSnapshot } from '../providers/types';

interface PersistedData {
  snapshots: UsageSnapshot[];
  profile: AccountProfile | null;
}

// Store en memoria con persistencia JSON — sin WASM ni dependencias nativas
export class DatabaseService {
  private snapshots: UsageSnapshot[] = [];
  private profile: AccountProfile | null = null;
  private readonly dbPath: string | null;

  constructor(dbPath: string | null = null) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    if (!this.dbPath) return;
    try {
      const raw = readFileSync(this.dbPath, 'utf-8');
      const data = JSON.parse(raw) as PersistedData;
      this.snapshots = data.snapshots ?? [];
      this.profile = data.profile ?? null;
    } catch {
      // Archivo no existe aún — se creará al primer guardado
    }
  }

  private persist(): void {
    if (!this.dbPath) return;
    const data: PersistedData = { snapshots: this.snapshots, profile: this.profile };
    writeFileSync(this.dbPath, JSON.stringify(data), 'utf-8');
  }

  insertSnapshot(snapshot: UsageSnapshot): void {
    this.snapshots.push(snapshot);

    // Mantener solo los últimos 90 días
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    this.snapshots = this.snapshots.filter(s => s.timestamp >= cutoff);

    this.persist();
  }

  getSnapshots(provider: string, hours: number): UsageSnapshot[] {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return this.snapshots.filter(s => s.provider === provider && s.timestamp >= since);
  }

  getAllSnapshots(provider: string): UsageSnapshot[] {
    return this.snapshots.filter(s => s.provider === provider);
  }

  getSnapshotCount(): number {
    return this.snapshots.length;
  }

  // Tamaño del archivo de persistencia en bytes. 0 si es store en memoria o no existe aún.
  getStorageBytes(): number {
    if (!this.dbPath) return 0;
    try {
      return statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }

  upsertProfile(profile: AccountProfile): void {
    this.profile = profile;
    this.persist();
  }

  getProfile(provider: string): AccountProfile | null {
    return this.profile?.provider === provider ? this.profile : null;
  }

  purgeOldSnapshots(retentionDays: number): void {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const before = this.snapshots.length;
    this.snapshots = this.snapshots.filter(s => s.timestamp >= cutoff);
    if (this.snapshots.length !== before) this.persist();
  }

  close(): void {
    // No hay conexión que cerrar
  }
}
