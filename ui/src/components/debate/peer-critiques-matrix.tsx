"use client";

import React from 'react';
import type { FullDebateSummary, ParticipantAgentId } from '@/lib/debate/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SwordsIcon, ArrowUpRightIcon, ArrowDownRightIcon, MessageSquareQuoteIcon } from 'lucide-react';

interface PeerCritiquesMatrixProps {
  debate?: FullDebateSummary | null;
  className?: string;
}

export function PeerCritiquesMatrix({ debate, className }: PeerCritiquesMatrixProps) {
  if (!debate) return null;

  const round2 = debate.rounds.round2;
  const agents: ParticipantAgentId[] = ['price', 'fii', 'dii', 'retail'];

  return (
    <Card className={cn('bg-zinc-950 border-zinc-800 text-zinc-100 shadow-xl overflow-hidden', className)}>
      <CardHeader className="border-b border-zinc-800/80 pb-3 bg-zinc-900/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SwordsIcon className="w-5 h-5 text-amber-400" />
            <CardTitle className="text-sm font-semibold text-zinc-200">
              Round 2 Adversarial Peer Cross-Examinations & Deltas
            </CardTitle>
          </div>
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs">
            Dynamic Conviction Recalibration
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {agents.map((agentId) => {
            const signal = round2[agentId];
            if (!signal) return null;

            const critiques = signal.metadata?.critiques || [];
            const delta = signal.metadata?.probabilityDelta ?? 0;

            return (
              <div
                key={agentId}
                className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold uppercase text-xs text-zinc-200">
                      [{agentId}]
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        signal.direction === 'up'
                          ? 'border-emerald-500/30 text-emerald-400'
                          : 'border-red-500/30 text-red-400'
                      )}
                    >
                      {signal.direction.toUpperCase()} ({Math.round(signal.probability * 100)}%)
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-mono">
                    <span className="text-zinc-500">Δ Conviction:</span>
                    <span
                      className={cn(
                        'font-bold flex items-center',
                        delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-zinc-400'
                      )}
                    >
                      {delta > 0 ? <ArrowUpRightIcon className="w-3.5 h-3.5" /> : delta < 0 ? <ArrowDownRightIcon className="w-3.5 h-3.5" /> : null}
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  </div>
                </div>

                {/* Critiques List */}
                <div className="space-y-2">
                  {critiques.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic">No direct peer critiques submitted.</p>
                  ) : (
                    critiques.map((c, idx) => (
                      <div key={idx} className="text-xs bg-zinc-950/80 rounded p-2 border border-zinc-800/60">
                        <div className="flex items-center gap-1.5 mb-1 text-[11px] text-zinc-400 font-mono">
                          <MessageSquareQuoteIcon className="w-3.5 h-3.5 text-amber-400/80" />
                          <span>Target: <strong className="text-zinc-200 uppercase">{c.targetAgent}</strong></span>
                          <span className="text-zinc-600">•</span>
                          <span className="text-amber-300 font-sans capitalize">{c.agreementLevel.replace('_', ' ')}</span>
                        </div>
                        <p className="text-zinc-300 text-[11px] leading-relaxed">
                          {c.critiquePoint}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
