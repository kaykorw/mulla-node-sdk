import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', testing: 'src/testing/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node20',
  platform: 'neutral',
  // The testing entry imports the main entry by package name, so both share one copy of every class.
  external: ['@mulla/nodejs', /^node:/],
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Keep 'node:crypto' (not 'crypto'): the form Deno and Cloudflare Workers (nodejs_compat) resolve best.
  removeNodeProtocol: false,
});
