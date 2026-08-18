import { describe, it, expect } from 'vitest';
import { GET as getSymbols } from '@/app/api/symbols/route';
import { GET as getDebates } from '@/app/api/debates/route';

describe('Next.js API Routes', () => {
  it('GET /api/symbols returns symbol catalog including SBIFUNDS.NS', async () => {
    const res = await getSymbols();
    const data = await res.json();
    expect(data.symbols).toBeDefined();
    expect(data.symbols.length).toBeGreaterThanOrEqual(10);
    const sbiFunds = data.symbols.find((s: any) => s.symbol === 'SBIFUNDS.NS');
    expect(sbiFunds).toBeDefined();
    expect(sbiFunds.name).toContain('SBI Funds');
  });

  it('GET /api/debates returns debate summaries', async () => {
    const req = new Request('http://localhost:3000/api/debates?symbol=SBIFUNDS.NS');
    const res = await getDebates(req);
    const data = await res.json();
    expect(data.debates).toBeDefined();
    expect(data.debates.length).toBeGreaterThanOrEqual(1);
    expect(data.debates[0].symbol).toBe('SBIFUNDS.NS');
    expect(data.debates[0].consensusDirection).toBe('down');
  });
});
