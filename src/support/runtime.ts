export const INSPECT = Symbol.for('nodejs.util.inspect.custom');

interface RuntimeGlobals {
  process?: { env?: Record<string, string | undefined>; version?: string; versions?: Record<string, string> };
  Bun?: { version?: string };
  Deno?: { version?: { deno?: string } };
}

const g = globalThis as unknown as RuntimeGlobals;

export function env(name: string): string | undefined {
  try {
    const value = g.process?.env?.[name];

    return value === undefined || value === '' ? undefined : value;
  } catch {
    // Deno without --allow-env throws.
    return undefined;
  }
}

export function runtimeName(): string {
  if (g.Bun?.version !== undefined) return `Bun/${g.Bun.version}`;
  if (g.Deno?.version?.deno !== undefined) return `Deno/${g.Deno.version.deno}`;
  if (g.process?.versions?.node !== undefined) return `Node/v${g.process.versions.node}`;

  return 'JavaScript';
}
