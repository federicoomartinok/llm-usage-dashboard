import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

// Mock del módulo fs antes de importar AuthService
vi.mock('fs');

import { AuthService } from '../../src/extension/services/auth';

// Credenciales de ejemplo para los tests
const SAMPLE_CREDENTIALS = {
  claudeAiOauth: {
    accessToken: 'sk-ant-oat01-test-access-token',
    refreshToken: 'sk-ant-ort01-test-refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000, // válido por 1 hora
    subscriptionType: 'pro',
    rateLimitTier: 'default_claude_ai',
  },
  organizationUuid: 'org-uuid-test',
};

const CREDENTIALS_PATH = '/home/user/.claude/.credentials.json';

describe('AuthService', () => {
  let authService: AuthService;
  const mockReadFileSync = vi.mocked(fs.readFileSync);

  beforeEach(() => {
    vi.resetAllMocks();
    authService = new AuthService(CREDENTIALS_PATH);
  });

  describe('getCredentials()', () => {
    it('lee las credenciales desde el archivo correctamente', () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(SAMPLE_CREDENTIALS));

      const result = authService.getCredentials();

      expect(mockReadFileSync).toHaveBeenCalledWith(CREDENTIALS_PATH, 'utf-8');
      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe(SAMPLE_CREDENTIALS.claudeAiOauth.accessToken);
      expect(result?.refreshToken).toBe(SAMPLE_CREDENTIALS.claudeAiOauth.refreshToken);
      expect(result?.expiresAt).toBe(SAMPLE_CREDENTIALS.claudeAiOauth.expiresAt);
      expect(result?.subscriptionType).toBe('pro');
      expect(result?.rateLimitTier).toBe('default_claude_ai');
    });

    it('retorna null cuando el archivo no existe', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const result = authService.getCredentials();

      expect(result).toBeNull();
    });

    it('retorna null cuando el JSON es inválido', () => {
      mockReadFileSync.mockReturnValue('{ invalid json }');

      const result = authService.getCredentials();

      expect(result).toBeNull();
    });

    it('retorna null cuando falta accessToken', () => {
      const incompleteCredentials = {
        claudeAiOauth: {
          ...SAMPLE_CREDENTIALS.claudeAiOauth,
          accessToken: '',
        },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(incompleteCredentials));

      const result = authService.getCredentials();

      expect(result).toBeNull();
    });
  });

  describe('isTokenExpired()', () => {
    it('detecta token válido (no expirado)', () => {
      // Token que expira en 1 hora — dentro del margen de 5 min
      const futureCredentials = {
        claudeAiOauth: {
          ...SAMPLE_CREDENTIALS.claudeAiOauth,
          expiresAt: Date.now() + 60 * 60 * 1000,
        },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(futureCredentials));

      expect(authService.isTokenExpired()).toBe(false);
    });

    it('detecta token expirado', () => {
      // Token que expiró hace 10 minutos
      const expiredCredentials = {
        claudeAiOauth: {
          ...SAMPLE_CREDENTIALS.claudeAiOauth,
          expiresAt: Date.now() - 10 * 60 * 1000,
        },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(expiredCredentials));

      expect(authService.isTokenExpired()).toBe(true);
    });

    it('detecta token dentro del margen de 5 minutos como expirado', () => {
      // Token que expira en 3 minutos — dentro del buffer de 5 min
      const almostExpiredCredentials = {
        claudeAiOauth: {
          ...SAMPLE_CREDENTIALS.claudeAiOauth,
          expiresAt: Date.now() + 3 * 60 * 1000,
        },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(almostExpiredCredentials));

      expect(authService.isTokenExpired()).toBe(true);
    });

    it('retorna true cuando no hay credenciales', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(authService.isTokenExpired()).toBe(true);
    });
  });

  describe('getAuthHeaders()', () => {
    it('retorna los headers de autenticación correctos', () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(SAMPLE_CREDENTIALS));
      const betaHeader = 'oauth-2025-04-20';

      const headers = authService.getAuthHeaders(betaHeader);

      expect(headers).not.toBeNull();
      expect(headers?.Authorization).toBe(
        `Bearer ${SAMPLE_CREDENTIALS.claudeAiOauth.accessToken}`
      );
      expect(headers?.['Content-Type']).toBe('application/json');
      expect(headers?.['anthropic-beta']).toBe(betaHeader);
    });

    it('retorna null cuando no hay credenciales disponibles', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const headers = authService.getAuthHeaders('oauth-2025-04-20');

      expect(headers).toBeNull();
    });

    it('usa el betaHeader proporcionado en el header anthropic-beta', () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(SAMPLE_CREDENTIALS));
      const customBeta = 'custom-beta-header-v2';

      const headers = authService.getAuthHeaders(customBeta);

      expect(headers?.['anthropic-beta']).toBe(customBeta);
    });
  });
});
