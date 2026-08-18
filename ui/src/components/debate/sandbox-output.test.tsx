// Unit test verifying distinct success vs error render branches in SandboxOutput
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SandboxOutput } from './sandbox-output';

describe('SandboxOutput', () => {
  it('renders normal Terminal output on success', () => {
    render(<SandboxOutput tool="run_backtest" status="success" output={{ sharpe: 1.2 }} stdout="Backtest complete" />);
    expect(screen.getByText(/Backtest complete/i)).toBeInTheDocument();
    expect(screen.queryByTestId('stack-trace')).not.toBeInTheDocument();
  });

  it('renders Stack Trace on error, distinct from success rendering', () => {
    render(<SandboxOutput tool="run_backtest" status="error" output={undefined} stderr="Traceback (most recent call last)..." />);
    expect(screen.getByTestId('stack-trace')).toBeInTheDocument();
  });
});
