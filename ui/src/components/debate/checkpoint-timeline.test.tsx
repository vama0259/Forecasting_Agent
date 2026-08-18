// Unit test verifying round rendering and round 3 accent in CheckpointTimeline
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CheckpointTimeline } from './checkpoint-timeline';
import { fullDebateFixture } from '@/lib/mock-debate/fixtures';

describe('CheckpointTimeline', () => {
  it('renders all 4 round labels', () => {
    render(<CheckpointTimeline events={fullDebateFixture} />);
    expect(screen.getByText(/independent/i)).toBeInTheDocument();
    expect(screen.getByText(/debate/i)).toBeInTheDocument();
    expect(screen.getByText(/devil/i)).toBeInTheDocument();
    expect(screen.getByText(/consensus/i)).toBeInTheDocument();
  });

  it('gives round 3 a visually distinct style attribute, not shared with rounds 1/2/4', () => {
    render(<CheckpointTimeline events={fullDebateFixture} />);
    const r3 = screen.getByTestId('checkpoint-round-3');
    const r1 = screen.getByTestId('checkpoint-round-1');
    expect(r3.style.getPropertyValue('--round-accent')).not.toBe(r1.style.getPropertyValue('--round-accent'));
  });
});
