// Tests for DomainAllowlist verifying domain filtering, subdomain matching, and spoof rejection.

import { describe, it, expect } from 'vitest';
import { DomainAllowlist } from '../../src/search/allowlist.js';
import type { SearchResult } from '../../src/search/types.js';

const r = (hostname: string | null): SearchResult => ({
  rank: 1,
  title: 't',
  url: 'https://x/',
  hostname,
  content: 'c',
});

describe('DomainAllowlist', () => {
  const list = new DomainAllowlist(['moneycontrol.com', 'nseindia.com']);

  it('admits an exact host and a www subdomain', () => {
    expect(list.partition([r('moneycontrol.com'), r('www.moneycontrol.com')]).allowed).toHaveLength(2);
  });

  it('rejects suffix-spoofing hosts', () => {
    const { allowed, rejected } = list.partition([
      r('notmoneycontrol.com'),
      r('evilmoneycontrol.com'),
      r('moneycontrol.com.evil.tld'),
    ]);
    expect(allowed).toHaveLength(0);
    expect(rejected).toHaveLength(3);
  });

  it('rejects a null hostname', () => {
    expect(list.partition([r(null)]).allowed).toHaveLength(0);
  });

  it('preserves order and returns every input in exactly one bucket', () => {
    const input = [r('moneycontrol.com'), r('google.com'), r('www.nseindia.com')];
    const { allowed, rejected } = list.partition(input);
    expect(allowed.map((x) => x.hostname)).toEqual(['moneycontrol.com', 'www.nseindia.com']);
    expect(rejected.map((x) => x.hostname)).toEqual(['google.com']);
    expect(allowed.length + rejected.length).toBe(input.length);
  });
});
