// Build once; end users receive the renderer and need only Node.js, not esbuild.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const esbuild = require(process.argv[2] || 'esbuild');
esbuild.buildSync({ entryPoints: [resolve(root, 'vendor/qce/lib/core/exporter/ModernHtmlExporter.ts')],
  outfile: resolve(root, 'vendor/qce/renderer.mjs'), bundle: true, platform: 'node',
  format: 'esm', target: 'node18', legalComments: 'inline',
  banner: { js: '// GPL-3.0-only. Bundled from vendor/qce/lib; see vendor/qce/NOTICE.md and LICENSE.' } });
console.log('Built vendor/qce/renderer.mjs');
