import { readFileSync, writeFileSync } from 'fs';
import type { Database as SqlDatabase, SqlJsStatic } from 'sql.js';
import type { AccountProfile, UsageSnapshot } from '../providers/types';

// DDL del esquema — snapshots de uso y perfiles de cuenta
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS usage_snapshots (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    provider              TEXT    NOT NULL,
    timestamp             TEXT    NOT NULL,
    five_hour_utilization REAL    NOT NULL,
    five_hour_resets_at   TEXT,
    seven_day_utilization REAL    NOT NULL,
    seven_day_resets_at   TEXT,
    seven_day_sonnet_utilization REAL NOT NULL,
    seven_day_sonnet_resets_at   TEXT,
    extra_is_enabled      INTEGER NOT NULL,
    extra_monthly_limit   REAL    NOT NULL,
    extra_used_credits    REAL    NOT NULL,
    extra_utilization     REAL
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_provider_ts
    ON usage_snapshots (provider, timestamp);

  CREATE TABLE IF NOT EXISTS account_profiles (
    provider               TEXT PRIMARY KEY,
    email                  TEXT NOT NULL,
    display_name           TEXT NOT NULL,
    plan_type              TEXT NOT NULL,
    tier                   TEXT NOT NULL,
    billing_type           TEXT NOT NULL,
    subscription_status    TEXT NOT NULL,
    subscription_created_at TEXT NOT NULL,
    last_fetched_at        TEXT NOT NULL
  );
`;

export class DatabaseService {
  private db: SqlDatabase | null = null;
  private sqlJs: SqlJsStatic | null = null;
  private readonly dbPath: string | null;

  constructor(dbPath: string | null = null) {
    this.dbPath = dbPath;
  }

  // Inicializa la DB en memoria (o carga desde disco si dbPath está definido)
  async initialize(): Promise<void> {
    // Importación dinámica para evitar problemas con el entorno de extensión
    const initSqlJs = (await import('sql.js')).default;
    this.sqlJs = await initSqlJs();

    let data: ArrayLike<number> | null = null;
    if (this.dbPath) {
      try {
        data = readFileSync(this.dbPath);
      } catch {
        // La DB aún no existe — se creará una nueva
      }
    }

    this.db = new this.sqlJs.Database(data);
    this.db.run(SCHEMA_SQL);
  }

  // Persiste la DB en disco si dbPath está configurado
  private persist(): void {
    if (!this.db || !this.dbPath) return;
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  private assertOpen(): SqlDatabase {
    if (!this.db) throw new Error('DatabaseService no está inicializada — llama a initialize() primero');
    return this.db;
  }

  // Inserta un snapshot de uso en la tabla
  insertSnapshot(snapshot: UsageSnapshot): void {
    const db = this.assertOpen();
    db.run(
      `INSERT INTO usage_snapshots (
        provider, timestamp,
        five_hour_utilization, five_hour_resets_at,
        seven_day_utilization, seven_day_resets_at,
        seven_day_sonnet_utilization, seven_day_sonnet_resets_at,
        extra_is_enabled, extra_monthly_limit, extra_used_credits, extra_utilization
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        snapshot.provider,
        snapshot.timestamp,
        snapshot.fiveHour.utilization,
        snapshot.fiveHour.resetsAt,
        snapshot.sevenDay.utilization,
        snapshot.sevenDay.resetsAt,
        snapshot.sevenDaySonnet.utilization,
        snapshot.sevenDaySonnet.resetsAt,
        snapshot.extraUsage.isEnabled ? 1 : 0,
        snapshot.extraUsage.monthlyLimit,
        snapshot.extraUsage.usedCredits,
        snapshot.extraUsage.utilization,
      ],
    );
    this.persist();
  }

  // Retorna snapshots de un provider dentro de las últimas `hours` horas
  getSnapshots(provider: string, hours: number): UsageSnapshot[] {
    const db = this.assertOpen();
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const results = db.exec(
      `SELECT
        provider, timestamp,
        five_hour_utilization, five_hour_resets_at,
        seven_day_utilization, seven_day_resets_at,
        seven_day_sonnet_utilization, seven_day_sonnet_resets_at,
        extra_is_enabled, extra_monthly_limit, extra_used_credits, extra_utilization
       FROM usage_snapshots
       WHERE provider = ? AND timestamp >= ?
       ORDER BY timestamp ASC`,
      [provider, since],
    );

    if (results.length === 0) return [];

    return results[0].values.map((row) => ({
      provider:  row[0] as string,
      timestamp: row[1] as string,
      fiveHour: {
        utilization: row[2] as number,
        resetsAt:    row[3] as string | null,
      },
      sevenDay: {
        utilization: row[4] as number,
        resetsAt:    row[5] as string | null,
      },
      sevenDaySonnet: {
        utilization: row[6] as number,
        resetsAt:    row[7] as string | null,
      },
      extraUsage: {
        isEnabled:    (row[8] as number) === 1,
        monthlyLimit: row[9]  as number,
        usedCredits:  row[10] as number,
        utilization:  row[11] as number | null,
      },
    }));
  }

  // Inserta o actualiza el perfil de una cuenta por provider
  upsertProfile(profile: AccountProfile): void {
    const db = this.assertOpen();
    db.run(
      `INSERT INTO account_profiles (
        provider, email, display_name, plan_type, tier,
        billing_type, subscription_status, subscription_created_at, last_fetched_at
      ) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider) DO UPDATE SET
        email                  = excluded.email,
        display_name           = excluded.display_name,
        plan_type              = excluded.plan_type,
        tier                   = excluded.tier,
        billing_type           = excluded.billing_type,
        subscription_status    = excluded.subscription_status,
        subscription_created_at = excluded.subscription_created_at,
        last_fetched_at        = excluded.last_fetched_at`,
      [
        profile.provider,
        profile.email,
        profile.displayName,
        profile.planType,
        profile.tier,
        profile.billingType,
        profile.subscriptionStatus,
        profile.subscriptionCreatedAt,
        profile.lastFetchedAt,
      ],
    );
    this.persist();
  }

  // Retorna el perfil de un provider, o null si no existe
  getProfile(provider: string): AccountProfile | null {
    const db = this.assertOpen();
    const results = db.exec(
      `SELECT provider, email, display_name, plan_type, tier,
              billing_type, subscription_status, subscription_created_at, last_fetched_at
       FROM account_profiles WHERE provider = ?`,
      [provider],
    );

    if (results.length === 0 || results[0].values.length === 0) return null;

    const row = results[0].values[0];
    return {
      provider:              row[0] as string,
      email:                 row[1] as string,
      displayName:           row[2] as string,
      planType:              row[3] as string,
      tier:                  row[4] as string,
      billingType:           row[5] as string,
      subscriptionStatus:    row[6] as string,
      subscriptionCreatedAt: row[7] as string,
      lastFetchedAt:         row[8] as string,
    };
  }

  // Elimina snapshots más antiguos que `retentionDays` días
  purgeOldSnapshots(retentionDays: number): void {
    const db = this.assertOpen();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    db.run(`DELETE FROM usage_snapshots WHERE timestamp < ?`, [cutoff]);
    this.persist();
  }

  // Cierra la conexión y libera memoria
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
