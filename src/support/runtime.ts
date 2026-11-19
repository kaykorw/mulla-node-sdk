/** @internal Symbol Node's util.inspect (console.log) uses for custom output. */
export const INSPECT = Symbol.for('nodejs.util.inspect.custom');

interface RuntimeGlobals {
  process?: { env?: Record<string, string | undefined>; version?: string; versions?: Record<string, string> };
  Bun?: { version?: string };
  Deno?: { version?: { deno?: string } };
}

const g = globalThis as unknown as RuntimeGlobals;

/** @internal Reads an environment variable on runtimes that have process.env (Node, Bun, Deno, Workers with nodejs_compat). */
export function env(name: string): string | undefined {
  try {
    const value = g.process?.env?.[name];

    return value === undefined || value === '' ? undefined : value;
  } catch {
    // Deno without --allow-env throws.
    return undefined;
  }
}

/** @internal e.g. "Node/v22.11.0", "Bun/1.2.0", "Deno/2.1.0". */
export function runtimeName(): string {
  if (g.Bun?.version !== undefined) return `Bun/${g.Bun.version}`;
  if (g.Deno?.version?.deno !== undefined) return `Deno/${g.Deno.version.deno}`;
  if (g.process?.versions?.node !== undefined) return `Node/v${g.process.versions.node}`;

  return 'JavaScript';
}
