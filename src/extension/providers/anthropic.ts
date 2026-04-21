import * as https from 'https';
import type { AuthService } from '../services/auth';
import type { UsageProvider, UsageSnapshot, AccountProfile, UsageWindow, ExtraUsage } from './types';

// Formas crudas que devuelve la API de Anthropic
interface RawUsageWindow {
  utilization: number | null;
  resets_at: string | null;
}

interface RawExtraUsage {
  is_enabled: boolean;
  monthly_limit: number;
  used_credits: number;
  utilization: number | null;
}

interface RawUsageResponse {
  five_hour?: RawUsageWindow | null;
  seven_day?: RawUsageWindow | null;
  seven_day_sonnet?: RawUsageWindow | null;
  extra_usage?: RawExtraUsage | null;
}

interface RawProfileAccount {
  full_name?: string | null;
  email?: string | null;
  has_claude_max?: boolean | null;
}

interface RawProfileOrganization {
  organization_type?: string | null;
  rate_limit_tier?: string | null;
  billing_type?: string | null;
  subscription_status?: string | null;
  subscription_created_at?: string | null;
}

interface RawProfileResponse {
  account?: RawProfileAccount | null;
  organization?: RawProfileOrganization | null;
}

const API_HOST = 'api.anthropic.com';

export class AnthropicProvider implements UsageProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';

  constructor(
    private readonly auth: AuthService,
    private readonly betaHeader: string
  ) {}

  async isConfigured(): Promise<boolean> {
    return this.auth.getCredentials() !== null;
  }

  async fetchUsage(): Promise<UsageSnapshot> {
    const data = await this.apiGet('/api/oauth/usage') as RawUsageResponse;
    return this.parseUsageResponse(data);
  }

  async fetchProfile(): Promise<AccountProfile> {
    const data = await this.apiGet('/api/oauth/profile') as RawProfileResponse;
    return this.parseProfileResponse(data);
  }

  // Convierte la respuesta cruda de usage a UsageSnapshot normalizado
  public parseUsageResponse(data: RawUsageResponse): UsageSnapshot {
    return {
      provider: this.id,
      timestamp: new Date().toISOString(),
      fiveHour: this.parseWindow(data.five_hour),
      sevenDay: this.parseWindow(data.seven_day),
      sevenDaySonnet: this.parseWindow(data.seven_day_sonnet),
      extraUsage: this.parseExtraUsage(data.extra_usage),
    };
  }

  // Convierte la respuesta cruda de profile a AccountProfile normalizado
  public parseProfileResponse(data: RawProfileResponse): AccountProfile {
    const account = data.account ?? {};
    const org = data.organization ?? {};

    return {
      provider: this.id,
      email: account.email ?? '',
      displayName: account.full_name ?? '',
      planType: org.organization_type ?? '',
      tier: org.rate_limit_tier ?? '',
      billingType: org.billing_type ?? '',
      subscriptionStatus: org.subscription_status ?? '',
      subscriptionCreatedAt: org.subscription_created_at ?? '',
      lastFetchedAt: new Date().toISOString(),
    };
  }

  private parseWindow(raw: RawUsageWindow | null | undefined): UsageWindow {
    if (!raw) {
      return { utilization: 0, resetsAt: null };
    }
    return {
      utilization: raw.utilization ?? 0,
      resetsAt: raw.resets_at ?? null,
    };
  }

  private parseExtraUsage(raw: RawExtraUsage | null | undefined): ExtraUsage {
    if (!raw) {
      return { isEnabled: false, monthlyLimit: 0, usedCredits: 0, utilization: null };
    }
    return {
      isEnabled: raw.is_enabled ?? false,
      monthlyLimit: (raw.monthly_limit ?? 0) / 100,  // API devuelve centavos
      usedCredits: (raw.used_credits ?? 0) / 100,    // API devuelve centavos
      utilization: raw.utilization ?? null,
    };
  }

  // Realiza un GET autenticado a la API de Anthropic
  private apiGet(path: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const headers = this.auth.getAuthHeaders(this.betaHeader);
      if (!headers) {
        reject(new Error('Sin credenciales disponibles para la solicitud'));
        return;
      }

      const options: https.RequestOptions = {
        hostname: API_HOST,
        path,
        method: 'GET',
        headers,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));

        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Respuesta JSON inválida: ${body}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }
}
