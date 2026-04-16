import React from 'react';
import type { AccountProfile } from '../../extension/providers/types';

interface AccountSummaryProps {
  profile: AccountProfile;
}

// Convierte claves snake_case del API a nombres legibles
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

// Muestra el nivel del plan (ej. "5x", "10x") si está disponible
function formatTier(tier: string): string {
  if (!tier || tier === 'default') return '';
  return tier;
}

// Formatea fecha de suscripción para mostrar mes y año
function formatSubDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

export function AccountSummary({ profile }: AccountSummaryProps) {
  const plan = formatPlanName(profile.planType);
  const tier = formatTier(profile.tier);
  const subDate = formatSubDate(profile.subscriptionCreatedAt);

  return (
    <div>
      {/* Nombre · plan · nivel */}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fg)' }}>
        {profile.displayName}
        {plan && (
          <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>
            {' · '}{plan}
            {tier && <span> · {tier}</span>}
          </span>
        )}
      </div>

      {/* Estado y fecha de inicio */}
      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor:
              profile.subscriptionStatus === 'active' ? 'var(--color-ok)' : 'var(--color-warn)',
            marginRight: 4,
            verticalAlign: 'middle',
          }}
        />
        {profile.subscriptionStatus === 'active' ? 'Activa' : profile.subscriptionStatus}
        {subDate && <span> · desde {subDate}</span>}
      </div>
    </div>
  );
}
