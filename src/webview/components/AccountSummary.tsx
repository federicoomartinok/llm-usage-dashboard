import React from 'react';
import type { AccountProfile } from '../../extension/providers/types';

interface AccountSummaryProps {
  profile: AccountProfile;
}

function formatPlanName(planType: string): string {
  const map: Record<string, string> = {
    claude_max: 'Claude Max',
    claude_pro: 'Claude Pro',
    claude_free: 'Claude Free',
    claude_team: 'Claude Team',
    claude_enterprise: 'Claude Enterprise',
  };
  return map[planType] ?? planType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTier(tier: string): string {
  if (!tier || tier === 'default') return '';
  return tier;
}

function formatSubDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
}

export function AccountSummary({ profile }: AccountSummaryProps) {
  const plan = formatPlanName(profile.planType);
  const tier = formatTier(profile.tier);
  const subDate = formatSubDate(profile.subscriptionCreatedAt);
  const isActive = profile.subscriptionStatus === 'active';

  return (
    <div
      className="glass-card"
      style={{
        padding: '10px 12px',
      }}
    >
      {/* Nombre + plan chip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--color-fg)',
            letterSpacing: '-0.01em',
          }}
        >
          {profile.displayName}
        </span>
        {plan && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 999,
              background: 'rgba(137, 180, 250, 0.15)',
              border: '1px solid rgba(137, 180, 250, 0.4)',
              color: 'var(--color-accent)',
              letterSpacing: '0.02em',
            }}
          >
            {plan}{tier && ` · ${tier}`}
          </span>
        )}
      </div>

      {/* Estado + suscripción */}
      <div
        style={{
          fontSize: 10,
          color: 'var(--color-muted-dim)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          className={isActive ? 'animate-pulse-soft' : ''}
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: isActive ? 'var(--color-ok)' : 'var(--color-warn)',
            boxShadow: isActive ? '0 0 6px var(--color-ok)' : 'none',
          }}
        />
        <span>{isActive ? 'Activa' : profile.subscriptionStatus}</span>
        {subDate && (
          <>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>desde {subDate}</span>
          </>
        )}
      </div>
    </div>
  );
}
