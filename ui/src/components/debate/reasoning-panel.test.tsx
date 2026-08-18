// Unit test verifying accumulated reasoning text rendering in ReasoningPanel
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReasoningPanel } from './reasoning-panel';

describe('ReasoningPanel', () => {
  it('renders accumulated reasoning text', () => {
    render(<ReasoningPanel agent="sentiment" text="Sentiment is turning bullish because..." streaming={false} />);
    expect(screen.getByText(/turning bullish/i)).toBeInTheDocument();
  });
});
