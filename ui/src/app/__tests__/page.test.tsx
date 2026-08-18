// Integration test verifying end-to-end rendering and tab switching of the debate transparency dashboard
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { mockDebateSummary } from '@/lib/debate/fixtures';
import Page from '../page';

// Mock fetch for /api/debates and /api/symbols
global.fetch = vi.fn((url: string | URL | Request) => {
  const urlStr = url.toString();
  if (urlStr.includes('/api/symbols')) {
    return Promise.resolve({
      json: () => Promise.resolve({ symbols: [{ symbol: 'SBIFUNDS.NS', name: 'SBI Funds Management Limited' }] }),
    });
  }
  return Promise.resolve({
    json: () => Promise.resolve({ debates: [mockDebateSummary] }),
  });
}) as any;

describe('debate viewer page', () => {
  it('renders 4 participant agents, consensus hero, and transparency tabs', async () => {
    await act(async () => {
      render(<Page />);
    });

    // 1. Brand & Header
    expect(screen.getByText(/forecasting agent/i)).toBeInTheDocument();
    expect(screen.getByText(/4-Round Multi-Agent Deliberation/i)).toBeInTheDocument();

    // 2. 4 Participant Sub-Agents
    expect(screen.getByText(/price action anchor/i)).toBeInTheDocument();
    expect(screen.getByText(/fii derivative intent/i)).toBeInTheDocument();
    expect(screen.getByText(/dii liquidity support/i)).toBeInTheDocument();
    expect(screen.getByText(/retail microstructure/i)).toBeInTheDocument();

    // 3. Consensus Card & Gauges
    expect(screen.getAllByText(/Deterministic Consensus/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/DOWN/i).length).toBeGreaterThanOrEqual(1);

    // 4. Transparency Tabs
    expect(screen.getByText(/charts & probability shifts/i)).toBeInTheDocument();
    expect(screen.getByText(/docker python scripts & logs/i)).toBeInTheDocument();
    expect(screen.getByText(/peer cross-examinations/i)).toBeInTheDocument();
    expect(screen.getByText(/devil's advocate & tail risks/i)).toBeInTheDocument();

    // 5. Switch to Python Scripts Explorer Tab
    const scriptsTab = screen.getByText(/docker python scripts & logs/i);
    await act(async () => {
      fireEvent.click(scriptsTab);
    });

    expect(screen.getByText(/Docker Sandbox Code & Execution Explorer/i)).toBeInTheDocument();
    expect(screen.getAllByText(/retail_features.py/i).length).toBeGreaterThanOrEqual(1);

    // 6. Switch to Peer Cross-Examinations Tab
    const critiquesTab = screen.getByText(/peer cross-examinations/i);
    await act(async () => {
      fireEvent.click(critiquesTab);
    });

    expect(screen.getByText(/Adversarial Peer Cross-Examinations/i)).toBeInTheDocument();

    // 7. Switch to Devil's Advocate Tab
    const daTab = screen.getByText(/devil's advocate & tail risks/i);
    await act(async () => {
      fireEvent.click(daTab);
    });

    expect(screen.getByText(/Appointed Devil's Advocate/i)).toBeInTheDocument();
    expect(screen.getByText(/Explicit Invalidation Trigger Levels/i)).toBeInTheDocument();
  });
});
