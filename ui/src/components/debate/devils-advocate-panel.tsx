"use client";

import React from 'react';
import type { FullDebateSummary } from '@/lib/debate/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { FlameIcon, AlertOctagonIcon, CrosshairIcon, ShieldAlertIcon } from 'lucide-react';

interface DevilsAdvocatePanelProps {
  debate?: FullDebateSummary | null;
  className?: string;
}

export function DevilsAdvocatePanel({ debate, className }: DevilsAdvocatePanelProps) {
  if (!debate) return null;

  const round3 = debate.rounds.round3;
  // Find designated Devil's Advocate agent
  const daEntry = Object.entries(round3).find(([_, sig]) => sig.metadata?.isDevilsAdvocate);
  const daAgent = daEntry ? daEntry[0] : 'fii';
  const daSignal = daEntry ? daEntry[1] : round3.fii || round3.retail;

  const catastrophicRisks = daSignal?.metadata?.catastrophicRisks || [
    'Violent short-covering gap if 561.15 is reclaimed on heavy volume',
    'Sector-wide fund redemption shock creates liquidity blindspot on thin order book',
  ];

  const invalidationTriggers = daSignal?.metadata?.invalidationTriggers || [
    'Daily close above ₹561.15 (prior session high)',
    'Reclaim of 5-day moving average ₹563.42 on volume > 2.67M shares',
  ];

  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-4', className)}>
      {/* Devil's Advocate Selection & Rationale */}
      <Card className="bg-zinc-950 border-zinc-800 text-zinc-100 shadow-xl">
        <CardHeader className="border-b border-zinc-800/80 pb-3 bg-red-950/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FlameIcon className="w-5 h-5 text-red-500" />
              <CardTitle className="text-sm font-semibold text-zinc-200">
                Appointed Devil's Advocate: [{daAgent.toUpperCase()}]
              </CardTitle>
            </div>
            <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-300 text-xs">
              Hard Stress-Test Gate
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-300 leading-relaxed">
            <p className="font-semibold text-zinc-200 mb-1">Mathematical Selection Justification:</p>
            <p className="text-zinc-400">
              Agent was appointed because its domain evidence was furthest from the provisional group majority{' '}
              <code className="text-red-300 font-mono">max |P_i - P_majority|</code>. It was mandated to run counter-hypothesis Python scripts in Docker hunting for unmodeled tail risks.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <AlertOctagonIcon className="w-4 h-4" />
              Catastrophic Tail Risks Surfaced:
            </h4>
            <ul className="space-y-1.5 text-xs text-zinc-300">
              {catastrophicRisks.map((risk, idx) => (
                <li key={idx} className="p-2 rounded bg-zinc-900/80 border border-red-500/20 flex items-start gap-2">
                  <span className="text-red-400 font-mono font-bold">•</span>
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Numerical Invalidation Price Triggers */}
      <Card className="bg-zinc-950 border-zinc-800 text-zinc-100 shadow-xl">
        <CardHeader className="border-b border-zinc-800/80 pb-3 bg-amber-950/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CrosshairIcon className="w-5 h-5 text-amber-400" />
              <CardTitle className="text-sm font-semibold text-zinc-200">
                Explicit Invalidation Trigger Levels
              </CardTitle>
            </div>
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs">
              When Model Fails
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-zinc-400">
            If the market breaches any of the following numerical levels tomorrow, the <strong>DOWN</strong> forecast is immediately negated:
          </p>
          <div className="space-y-2">
            {invalidationTriggers.map((trigger, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded bg-zinc-900/90 border border-amber-500/30 flex items-start gap-2 text-xs font-mono text-amber-200"
              >
                <span className="text-amber-400 font-bold">[{idx + 1}]</span>
                <span className="leading-relaxed">{trigger}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
