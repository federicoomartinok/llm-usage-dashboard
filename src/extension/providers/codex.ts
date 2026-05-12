import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  CodexProviderApi,
  CodexSnapshot,
  CodexProfile,
  CodexUsageWindow,
} from './types';

// Estructura del archivo ~/.codex/auth.json — el shape exacto puede variar entre
// versiones del Codex CLI; tratamos varios fallbacks comunes.
interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
  };
  access_token?: string;
  OPENAI_API_KEY?: string;
}

interface RawCodexWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: string | null;
}

interface RawCodexUsage {
  plan_type?: string;
  rate_limit?: {
    primary_window?: RawCodexWindow;
    secondary_window?: RawCodexWindow;
  };
  credits?: {
    used?: number;
    limit?: number;
  };
}

const CODEX_HOST = 'chatgpt.com';
const CODEX_USAGE_PATH = '/api/codex/usage';

export class CodexProvider implements CodexProviderApi {
  readonly id = 'codex' as const;
  readonly name = 'Codex';
  private readonly authPath: string;

  constructor() {
    // CODEX_HOME env var override, fallback a ~/.codex
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    this.authPath = path.join(codexHome, 'auth.json');
  }

  async isConfigured(): Promise<boolean> {
    return this.getAccessToken() !== null;
  }

  async fetchUsage(): Promise<CodexSnapshot> {
    const data = (await this.apiGet(CODEX_USAGE_PATH)) as RawCodexUsage;
    return this.parseUsage(data);
  }

  async fetchProfile(): Promise<CodexProfile> {
    const data = (await this.apiGet(CODEX_USAGE_PATH)) as RawCodexUsage;
    return {
      provider: 'codex',
      email: '',
      planType: data.plan_type ?? 'unknown',
      lastFetchedAt: new Date().toISOString(),
    };
  }

  // Lee el access token del archivo OAuth de Codex CLI
  private getAccessToken(): string | null {
    try {
      const raw = fs.readFileSync(this.authPath, 'utf-8');
      const parsed = JSON.parse(raw) as CodexAuthFile;
      return parsed.tokens?.access_token ?? parsed.access_token ?? null;
    } catch {
      // Archivo inexistente, corrupto o sin permisos
      return null;
    }
  }

  private parseUsage(data: RawCodexUsage): CodexSnapshot {
    return {
      provider: 'codex',
      timestamp: new Date().toISOString(),
      planType: data.plan_type ?? 'unknown',
      primaryWindow: this.parseWindow(data.rate_limit?.primary_window),
      secondaryWindow: this.parseWindow(data.rate_limit?.secondary_window),
      credits: {
        used: data.credits?.used ?? 0,
        limit: data.credits?.limit ?? 0,
      },
    };
  }

  private parseWindow(raw: RawCodexWindow | undefined): CodexUsageWindow {
    if (!raw) {
      return { usedPercent: 0, windowMinutes: 0, resetsAt: null };
    }
    return {
      usedPercent: raw.used_percent ?? 0,
      windowMinutes: Math.round((raw.limit_window_seconds ?? 0) / 60),
      resetsAt: raw.reset_at ?? null,
    };
  }

  private apiGet(apiPath: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const token = this.getAccessToken();
      if (!token) {
        reject(new Error('Codex sin credenciales (~/.codex/auth.json no encontrado)'));
        return;
      }
      const options: https.RequestOptions = {
        hostname: CODEX_HOST,
        path: apiPath,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'codex-cli',
        },
      };
      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            reject(new Error(`Codex HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Codex respuesta JSON inválida'));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
}
