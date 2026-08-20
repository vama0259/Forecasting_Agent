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

  describe('expanded financial press and social channels', () => {
    const expandedList = new DomainAllowlist([
      'moneycontrol.com',
      'economictimes.indiatimes.com',
      'livemint.com',
      'bseindia.com',
      'nseindia.com',
      'business-standard.com',
      'financialexpress.com',
      'cnbctv18.com',
      'ndtvprofit.com',
      'thehindubusinessline.com',
      'reuters.com',
      'bloomberg.com',
      'mint.com',
      'x.com',
      'twitter.com',
      'reddit.com',
    ]);

    it('admits financial press domains and subdomains', () => {
      const financialHosts = [
        'business-standard.com',
        'www.business-standard.com',
        'financialexpress.com',
        'cnbctv18.com',
        'ndtvprofit.com',
        'thehindubusinessline.com',
        'reuters.com',
        'www.reuters.com',
        'bloomberg.com',
        'www.bloomberg.com',
        'mint.com',
      ];
      const { allowed, rejected } = expandedList.partition(financialHosts.map(r));
      expect(allowed).toHaveLength(financialHosts.length);
      expect(rejected).toHaveLength(0);
    });

    it('admits social media channels and subdomains', () => {
      const socialHosts = [
        'x.com',
        'twitter.com',
        'mobile.twitter.com',
        'reddit.com',
        'old.reddit.com',
        'www.reddit.com',
      ];
      const { allowed, rejected } = expandedList.partition(socialHosts.map(r));
      expect(allowed).toHaveLength(socialHosts.length);
      expect(rejected).toHaveLength(0);
    });

    it('rejects spoofed social and news domains', () => {
      const spoofHosts = [
        'fakex.com',
        'nottwitter.com',
        'reddit.com.scam.org',
        'bloomberg.com.attacker.com',
        'facebook.com',
        'instagram.com',
      ];
      const { allowed, rejected } = expandedList.partition(spoofHosts.map(r));
      expect(allowed).toHaveLength(0);
      expect(rejected).toHaveLength(spoofHosts.length);
    });
  });
});
