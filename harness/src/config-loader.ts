import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { HarnessConfigSchema, LLM_TARGET, type HarnessConfig } from './config.js';
import { ConfigValidationError } from './errors.js';

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)}/g;

class Interpolator {
  readonly used = new Set<string>();
  readonly missing = new Set<string>();

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  apply(node: unknown): unknown {
    if (typeof node === 'string') return this.expand(node);
    if (Array.isArray(node)) return node.map((item) => this.apply(item));
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, this.apply(value)]));
    }
    return node;
  }

  private expand(value: string): string {
    return value.replace(VAR_PATTERN, (_match, name: string) => {
      const resolved = this.env[name];
      if (resolved === undefined) {
        this.missing.add(name);
        return '';
      }
      this.used.add(resolved);
      return resolved;
    });
  }
}

function formatIssues(error: unknown): string[] {
  const zodError = error as { issues?: { path: PropertyKey[]; message: string }[] };
  return (zodError.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  const interpolator = new Interpolator(env);
  const interpolated = interpolator.apply(raw);
  const secrets = interpolator.used;

  if (interpolator.missing.size > 0) {
    throw new ConfigValidationError(
      [...interpolator.missing].map((name) => `environment variable ${name} is not set`),
      secrets,
    );
  }

  const result = HarnessConfigSchema.safeParse(interpolated);
  if (!result.success) throw new ConfigValidationError(formatIssues(result.error), secrets);

  const config = result.data;
  const dangling = Object.entries(config.capabilities)
    .filter(([, target]) => target !== LLM_TARGET && !(target in config.mcp_servers))
    .map(([name, target]) => `capabilities.${name}: "${target}" is not defined in mcp_servers`);
  if (dangling.length > 0) throw new ConfigValidationError(dangling, secrets);

  return config;
}
