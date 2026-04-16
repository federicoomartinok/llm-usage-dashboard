import * as fs from 'fs';

// Estructura interna del archivo de credenciales
interface ClaudeOauthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subscriptionType: string;
  rateLimitTier: string;
}

interface CredentialsFile {
  claudeAiOauth: ClaudeOauthCredentials;
  organizationUuid?: string;
}

export interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subscriptionType: string;
  rateLimitTier: string;
}

export interface AuthHeaders {
  Authorization: string;
  'Content-Type': string;
  'anthropic-beta': string;
}

// Margen de seguridad antes de considerar el token expirado (ms)
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class AuthService {
  private readonly credentialsPath: string;

  constructor(credentialsPath: string) {
    this.credentialsPath = credentialsPath;
  }

  getCredentials(): Credentials | null {
    try {
      const raw = fs.readFileSync(this.credentialsPath, 'utf-8');
      const parsed = JSON.parse(raw) as CredentialsFile;
      const oauth = parsed.claudeAiOauth;

      if (!oauth?.accessToken || !oauth?.refreshToken) {
        return null;
      }

      return {
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        expiresAt: oauth.expiresAt,
        subscriptionType: oauth.subscriptionType,
        rateLimitTier: oauth.rateLimitTier,
      };
    } catch {
      // Archivo inexistente, corrupto o sin permisos
      return null;
    }
  }

  isTokenExpired(): boolean {
    const credentials = this.getCredentials();
    if (!credentials) {
      return true;
    }
    return credentials.expiresAt < Date.now() + EXPIRY_BUFFER_MS;
  }

  getAuthHeaders(betaHeader: string): AuthHeaders | null {
    const credentials = this.getCredentials();
    if (!credentials) {
      return null;
    }

    return {
      Authorization: `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
      'anthropic-beta': betaHeader,
    };
  }
}
