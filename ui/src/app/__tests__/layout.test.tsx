// Test verifying design tokens in globals.css
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('design tokens', () => {
  it('globals.css defines the debate-viewer palette, not the zero-chroma preset default', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    expect(css).toContain('--agent-technical');
    expect(css).toContain('--agent-sentiment');
    expect(css).toContain('--agent-macro');
    expect(css).toContain('--round-challenge');
    expect(css).toContain('--signal-bull');
    expect(css).toContain('--signal-bear: #EF4444'); // NOT #DC2626 — the AA-failing color rejected in spec review
  });
});
