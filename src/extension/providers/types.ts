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

export type ExtensionMessage =
  | { type: 'state'; current: UsageSnapshot | null; history: UsageSnapshot[]; profile: AccountProfile | null }
  | { type: 'usage-update'; data: UsageSnapshot }
  | { type: 'profile-update'; data: AccountProfile }
  | { type: 'error'; message: string };

export type WebviewMessage =
  | { type: 'init' }
  | { type: 'request-history'; hours: number }
  | { type: 'refresh-now' };
