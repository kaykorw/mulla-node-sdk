/**
 * Packs the package, installs the tarball into an empty temp project and checks that it loads
 * with `import` and `require`, that both entries share classes, and that the types resolve
 * for TypeScript users (node16 resolution, ESM and CJS).
 *
 *   npm run build && node scripts/smoke-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// npm.cmd needs a shell on Windows; node itself must run without one (its path may contain spaces).
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8', shell: cmd === 'npm.cmd' });

const dir = mkdtempSync(join(tmpdir(), 'mulla-node-smoke-'));
try {
  // npm <= 11 prints an array, npm 12 an object keyed by package name.
  const output = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', dir], root));
  const packed = Array.isArray(output) ? output[0] : Object.values(output)[0];
  const tarball = join(dir, packed.filename);
  const files = packed.files.map((f) => f.path);
  for (const unwanted of ['src/', 'tests/', '.github/', 'node_modules/']) {
    if (files.some((f) => f.startsWith(unwanted))) throw new Error(`tarball contains ${unwanted}`);
  }

  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
  run(npm, ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], dir);

  const check = `
    const fake = new FakeTransport().pushConnectionError('refused', false).pushJson({ id: 'chg_1', status: 'PENDING' });
    const mulla = new MullaClient('sk_test_AbC123_secret', { transport: fake, sleep: async () => {} });
    const charge = await mulla.charges.retrieve('chg_1');
    if (charge.id !== 'chg_1' || fake.requests.length !== 2) throw new Error('shared classes broken');
    if (!(charge instanceof Charge)) throw new Error('model class mismatch');
    console.log('ok', VERSION);
  `;
  writeFileSync(
    join(dir, 'esm.mjs'),
    `import { MullaClient, Charge, VERSION } from '@kayko/mulla-node';\nimport { FakeTransport } from '@kayko/mulla-node/testing';\n${check}`,
  );
  writeFileSync(
    join(dir, 'cjs.cjs'),
    `const { MullaClient, Charge, VERSION } = require('@kayko/mulla-node');\nconst { FakeTransport } = require('@kayko/mulla-node/testing');\n(async () => {${check}})().catch((e) => { console.error(e); process.exit(1); });`,
  );
  const esm = run(process.execPath, ['esm.mjs'], dir).trim();
  const cjs = run(process.execPath, ['cjs.cjs'], dir).trim();

  // Types: a TS consumer with node16 resolution, both module formats.
  const ts = `
    import { MullaClient, Provider, type Charge } from '@kayko/mulla-node';
    import { FakeTransport } from '@kayko/mulla-node/testing';
    const mulla = new MullaClient('sk_test_x_y', { transport: new FakeTransport() });
    export const p: Promise<Charge> = mulla.charges.initiate({ provider: Provider.MTN_RW, amount: 1, phoneNumber: '1' });
  `;
  writeFileSync(join(dir, 'esm.mts'), ts);
  writeFileSync(join(dir, 'cjs.cts'), ts);
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  run(
    process.execPath,
    [
      tsc,
      '--noEmit',
      '--strict',
      '--module',
      'node16',
      '--moduleResolution',
      'node16',
      '--types',
      'node',
      '--typeRoots',
      join(root, 'node_modules', '@types'),
      'esm.mts',
      'cjs.cts',
    ],
    dir,
  );

  console.log(`smoke-test passed: ${packed.filename} (${files.length} files); esm ${esm}; cjs ${cjs}; types ok`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
