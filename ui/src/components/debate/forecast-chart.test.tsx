// Unit test verifying direct series labels and accessibility fallback in ForecastChart
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForecastChart } from './forecast-chart';

const sample = {
  horizon: '5d',
  actual: [100, 101, 99, 102, 103],
  forecast: [103, 104, 105, 106, 107],
  confidenceBand: [[102, 108], [101, 109], [100, 110], [99, 111], [98, 112]] as [number, number][],
};

describe('ForecastChart', () => {
  it('renders direct labels for actual and forecast series, not color-only legend', () => {
    render(<ForecastChart data={sample} />);
    expect(screen.getByText(/actual/i)).toBeInTheDocument();
    expect(screen.getByText(/forecast/i)).toBeInTheDocument();
  });

  it('gives the confidence band an accessible summary, per spec a11y fallback requirement', () => {
    render(<ForecastChart data={sample} />);
    expect(screen.getByText(/confidence/i)).toBeInTheDocument();
  });
});
