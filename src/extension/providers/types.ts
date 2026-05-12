export interface UsageWindow {
  utilization: number;
  resetsAt: string | null;
}

export interface ExtraUsage {
  isEnabled: boolean;
  monthlyLimit: number;
  usedCredits: number;
  utilization: number | null;
}

export interface UsageSnapshot {
  provider: string;
  timestamp: string;
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
  sevenDaySonnet: UsageWindow;
  extraUsage: ExtraUsage;
}

export interface AccountProfile {
  provider: string;
  email: string;
  displayName: string;
  planType: string;
  tier: string;
  billingType: string;
  subscriptionStatus: string;
  subscriptionCreatedAt: string;
  lastFetchedAt: string;
}

export interface UsageProvider {
  id: string;
  name: string;
  isConfigured(): Promise<boolean>;
  fetchUsage(): Promise<UsageSnapshot>;
  fetchProfile(): Promise<AccountProfile>;
}

// ============================================================
// Codex (OpenAI ChatGPT subscription) — tipos paralelos
// ============================================================

export interface CodexUsageWindow {
  usedPercent: number;        // 0-100
  windowMinutes: number;      // duración de la ventana (5h = 300, 1 sem = 10080)
  resetsAt: string | null;    // ISO timestamp
}

export interface CodexCredits {
  used: number;               // USD
  limit: number;              // USD
}

export interface CodexSnapshot {
  provider: 'codex';
  timestamp: string;
  planType: string;           // free | plus | pro | business | enterprise
  primaryWindow: CodexUsageWindow;
  secondaryWindow: CodexUsageWindow;
  credits: CodexCredits;
}

export interface CodexProfile {
  provider: 'codex';
  email: string;
  planType: string;
  lastFetchedAt: string;
}

export interface CodexProviderApi {
  id: 'codex';
  name: string;
  isConfigured(): Promise<boolean>;
  fetchUsage(): Promise<CodexSnapshot>;
  fetchProfile(): Promise<CodexProfile>;
}

// ============================================================
// Mensajes webview ↔ extension
// ============================================================

export type ProviderId = 'anthropic' | 'codex';

export type ExtensionMessage =
  | { type: 'state'; current: UsageSnapshot | null; history: UsageSnapshot[]; profile: AccountProfile | null }
  | { type: 'usage-update'; data: UsageSnapshot }
  | { type: 'profile-update'; data: AccountProfile }
  | { type: 'error'; message: string };

export type WebviewMessage =
  | { type: 'init' }
  | { type: 'request-history'; hours: number }
  | { type: 'refresh-now' }
  | { type: 'set-active-provider'; provider: ProviderId };
