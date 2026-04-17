// Genera un dashboard.html de ejemplo con datos sintéticos para inspección visual.
// Uso: node scripts/preview-dashboard.mjs
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(tmpdir(), 'llm-usage-preview');
mkdirSync(outDir, { recursive: true });

// Compilar el exporter a un bundle ejecutable aislado
const bundlePath = join(outDir, 'exporter-bundle.mjs');
await build({
  entryPoints: [join(__dirname, '..', 'src/extension/services/html-exporter.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'error',
});

const { HtmlExporter } = await import(pathToFileURL(bundlePath).href);

// Historia de 18 horas (6 huecos al inicio para probar estado "sin datos")
const now = Date.now();
const history = Array.from({ length: 18 }, (_, i) => {
  const hoursAgo = 17 - i;
  const timestamp = new Date(now - hoursAgo * 3_600_000).toISOString();
  // Crecimiento gradual de utilización con algo de ruido
  const base = (i / 17) * 60;
  const sonnet = Math.min(100, base * 0.35 + Math.sin(i * 0.8) * 3);
  const weekly = Math.min(100, base + Math.sin(i * 0.4) * 5);
  return {
    provider: 'anthropic',
    timestamp,
    fiveHour: { utilization: Math.min(100, 20 + i * 2.2), resetsAt: new Date(now + 45 * 60_000).toISOString() },
    sevenDay: { utilization: weekly, resetsAt: new Date(now + 4 * 24 * 3_600_000).toISOString() },
    sevenDaySonnet: { utilization: sonnet, resetsAt: new Date(now + 4 * 24 * 3_600_000).toISOString() },
    extraUsage: { isEnabled: true, monthlyLimit: 100, usedCredits: 12.45, utilization: 12.45 },
  };
});

const profile = {
  provider: 'anthropic',
  email: 'fedemartindev05@gmail.com',
  displayName: 'Fede Martin',
  planType: 'claude_max',
  tier: '5x',
  billingType: 'Stripe',
  subscriptionStatus: 'active',
  subscriptionCreatedAt: '2026-03-15T00:00:00Z',
  lastFetchedAt: new Date().toISOString(),
};

const exporter = new HtmlExporter(outDir);
const html = exporter.generate(history[history.length - 1], profile, history, {
  snapshotCount: 1247,
  storageBytes: 2_150_000,
});

const previewPath = join(__dirname, '..', 'dashboard-preview.html');
writeFileSync(previewPath, html, 'utf-8');
console.log(`Preview generado: ${previewPath}`);

// Cleanup bundle temporal
rmSync(outDir, { recursive: true, force: true });
