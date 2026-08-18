// Unit test verifying source rendering and snippet display in EvidenceList
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceList } from './evidence-list';

describe('EvidenceList', () => {
  it('renders each evidence source with its snippet', () => {
    render(<EvidenceList items={[
      { source: 'Reuters', url: 'https://reuters.com/x', snippet: 'Q3 earnings beat estimates' },
      { source: 'Internal analysis', snippet: 'RSI shows oversold conditions' },
    ]} />);
    expect(screen.getByText(/Q3 earnings beat/i)).toBeInTheDocument();
    expect(screen.getByText(/RSI shows oversold/i)).toBeInTheDocument();
  });
});
