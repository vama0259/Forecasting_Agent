// Unit test verifying visible agent label and distinct agent cards
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentCard } from './agent-card';

describe('AgentCard', () => {
  it('renders the real agent names and roles as visible text', () => {
    render(
      <AgentCard
        agent="retail"
        active={false}
        direction="down"
        probability={0.7}
        confidence={0.6}
        degraded={true}
      />
    );
    expect(screen.getByText(/retail/i)).toBeInTheDocument();
    expect(screen.getByText(/retail microstructure/i)).toBeInTheDocument();
    expect(screen.getByText(/DOWN \(70%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/0.5× voting haircut/i)).toBeInTheDocument();
  });

  it('renders Price, FII, DII, and Retail cards cleanly', () => {
    const { rerender } = render(<AgentCard agent="price" active={true} />);
    expect(screen.getByText(/price action anchor/i)).toBeInTheDocument();

    rerender(<AgentCard agent="fii" active={false} />);
    expect(screen.getByText(/fii derivative intent/i)).toBeInTheDocument();

    rerender(<AgentCard agent="dii" active={false} />);
    expect(screen.getByText(/dii liquidity support/i)).toBeInTheDocument();
  });
});
