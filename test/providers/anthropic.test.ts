import { describe, it, expect, vi } from 'vitest';
import { AnthropicProvider } from '../../src/extension/providers/anthropic';
import type { AuthService } from '../../src/extension/services/auth';

// AuthService simulado — los tests solo ejercen los métodos de parseo
const mockAuth = {
  getCredentials: vi.fn().mockReturnValue({
    accessToken: 'sk-ant-oat01-test',
    refreshToken: 'sk-ant-ort01-test',
    expiresAt: Date.now() + 3600_000,
    subscriptionType: 'pro',
    rateLimitTier: 'default_claude_max_5x',
  }),
  isTokenExpired: vi.fn().mockReturnValue(false),
  getAuthHeaders: vi.fn().mockReturnValue({
    Authorization: 'Bearer sk-ant-oat01-test',
    'Content-Type': 'application/json',
    'anthropic-beta': 'oauth-2025-04-20',
  }),
} as unknown as AuthService;

const BETA_HEADER = 'oauth-2025-04-20';

const provider = new AnthropicProvider(mockAuth, BETA_HEADER);

// Respuesta completa de ejemplo que devuelve la API real
const FULL_USAGE_RESPONSE = {
  five_hour: { utilization: 29.0, resets_at: '2026-04-16T17:00:00Z' },
  seven_day: { utilization: 4.0, resets_at: '2026-04-21T12:00:00Z' },
  seven_day_sonnet: { utilization: 0.0, resets_at: '2026-04-21T15:00:00Z' },
  extra_usage: {
    is_enabled: true,
    monthly_limit: 10000,
    used_credits: 0,
    utilization: null,
  },
};

const FULL_PROFILE_RESPONSE = {
  account: {
    full_name: 'Fede',
    email: 'fede@test.com',
    has_claude_max: true,
  },
  organization: {
    organization_type: 'claude_max',
    rate_limit_tier: 'default_claude_max_5x',
    billing_type: 'stripe_subscription',
    subscription_status: 'active',
    subscription_created_at: '2026-03-03T13:32:29Z',
  },
};

describe('AnthropicProvider.parseUsageResponse()', () => {
  it('convierte correctamente una respuesta completa a UsageSnapshot', () => {
    const snapshot = provider.parseUsageResponse(FULL_USAGE_RESPONSE);

    expect(snapshot.provider).toBe('anthropic');
    expect(snapshot.timestamp).toBeTruthy();

    expect(snapshot.fiveHour.utilization).toBe(29.0);
    expect(snapshot.fiveHour.resetsAt).toBe('2026-04-16T17:00:00Z');

    expect(snapshot.sevenDay.utilization).toBe(4.0);
    expect(snapshot.sevenDay.resetsAt).toBe('2026-04-21T12:00:00Z');

    expect(snapshot.sevenDaySonnet.utilization).toBe(0.0);
    expect(snapshot.sevenDaySonnet.resetsAt).toBe('2026-04-21T15:00:00Z');

    expect(snapshot.extraUsage.isEnabled).toBe(true);
    expect(snapshot.extraUsage.monthlyLimit).toBe(10000);
    expect(snapshot.extraUsage.usedCredits).toBe(0);
    expect(snapshot.extraUsage.utilization).toBeNull();
  });

  it('usa defaults cuando seven_day_sonnet es null', () => {
    const snapshot = provider.parseUsageResponse({
      ...FULL_USAGE_RESPONSE,
      seven_day_sonnet: null,
    });

    expect(snapshot.sevenDaySonnet.utilization).toBe(0);
    expect(snapshot.sevenDaySonnet.resetsAt).toBeNull();
  });

  it('usa defaults cuando extra_usage es null', () => {
    const snapshot = provider.parseUsageResponse({
      ...FULL_USAGE_RESPONSE,
      extra_usage: null,
    });

    expect(snapshot.extraUsage.isEnabled).toBe(false);
    expect(snapshot.extraUsage.monthlyLimit).toBe(0);
    expect(snapshot.extraUsage.usedCredits).toBe(0);
    expect(snapshot.extraUsage.utilization).toBeNull();
  });

  it('maneja respuesta totalmente vacía sin lanzar errores', () => {
    const snapshot = provider.parseUsageResponse({});

    expect(snapshot.provider).toBe('anthropic');
    expect(snapshot.fiveHour.utilization).toBe(0);
    expect(snapshot.fiveHour.resetsAt).toBeNull();
    expect(snapshot.sevenDay.utilization).toBe(0);
    expect(snapshot.sevenDaySonnet.utilization).toBe(0);
    expect(snapshot.extraUsage.isEnabled).toBe(false);
  });
});

describe('AnthropicProvider.parseProfileResponse()', () => {
  it('convierte correctamente una respuesta completa a AccountProfile', () => {
    const profile = provider.parseProfileResponse(FULL_PROFILE_RESPONSE);

    expect(profile.provider).toBe('anthropic');
    expect(profile.email).toBe('fede@test.com');
    expect(profile.displayName).toBe('Fede');
    expect(profile.planType).toBe('claude_max');
    expect(profile.tier).toBe('default_claude_max_5x');
    expect(profile.billingType).toBe('stripe_subscription');
    expect(profile.subscriptionStatus).toBe('active');
    expect(profile.subscriptionCreatedAt).toBe('2026-03-03T13:32:29Z');
    expect(profile.lastFetchedAt).toBeTruthy();
  });

  it('usa strings vacíos cuando account y organization son null', () => {
    const profile = provider.parseProfileResponse({
      account: null,
      organization: null,
    });

    expect(profile.provider).toBe('anthropic');
    expect(profile.email).toBe('');
    expect(profile.displayName).toBe('');
    expect(profile.planType).toBe('');
    expect(profile.tier).toBe('');
    expect(profile.subscriptionStatus).toBe('');
  });

  it('maneja respuesta vacía sin lanzar errores', () => {
    const profile = provider.parseProfileResponse({});

    expect(profile.provider).toBe('anthropic');
    expect(profile.email).toBe('');
    expect(profile.subscriptionCreatedAt).toBe('');
  });
});
