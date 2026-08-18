"use client";

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  TrendingDownIcon,
  TrendingUpIcon,
  ScaleIcon,
  ShieldCheckIcon,
  ShieldAlertIcon,
  GaugeIcon,
  CrosshairIcon,
} from 'lucide-react';
import type { FullDebateSummary } from '@/lib/debate/types';

interface ConsensusDigestProps {
  debate?: FullDebateSummary | null;
  className?: string;
}

export function ConsensusDigest({ debate, className }: ConsensusDigestProps) {
  if (!debate) return null;

  const isDown = debate.consensusDirection === 'down';
  const probPct = Math.round(debate.consensusProbability * 100);
  const confPct = Math.round(debate.consensusConfidence * 100);

  return (
    <Card
      className={cn(
        'bg-zinc-950 border-zinc-800 text-zinc-100 shadow-xl overflow-hidden relative',
        isDown ? 'border-red-950/60' : 'border-emerald-950/60',
        className
      )}
    >
      <div
        className={cn(
          'absolute top-0 inset-x-0 h-1',
          isDown ? 'bg-gradient-to-r from-red-500 to-rose-600' : 'bg-gradient-to-r from-emerald-500 to-teal-400'
        )}
      />

      <CardHeader className="pb-3 border-b border-zinc-800/80 bg-zinc-900/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScaleIcon className="w-5 h-5 text-zinc-300" />
            <CardTitle className="text-sm font-semibold text-zinc-100">
              Round 4 Zero-LLM Deterministic Consensus
            </CardTitle>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'text-xs font-mono',
              debate.deadlockStatus === 'RESOLVED'
                ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                : 'border-amber-500/40 text-amber-400 bg-amber-500/10'
            )}
          >
            {debate.deadlockStatus}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-5 space-y-4">
        {/* Direction & Probability Hero Row */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-zinc-900/70 border border-zinc-800">
          <div>
            <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
              Consensus Direction
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              {isDown ? (
                <div className="flex items-center gap-1.5 text-2xl font-extrabold text-red-400 font-mono">
                  <TrendingDownIcon className="w-7 h-7" />
                  DOWN
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-2xl font-extrabold text-emerald-400 font-mono">
                  <TrendingUpIcon className="w-7 h-7" />
                  UP
                </div>
              )}
              <span className="text-xs text-zinc-500">for 1-Day Horizon</span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
              Directional Probability P(up)
            </span>
            <div className="text-2xl font-bold font-mono text-zinc-100">
              {probPct}%
            </div>
          </div>
        </div>

        {/* Confidence & Disagreement Gauges */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/80 space-y-1">
            <div className="flex items-center justify-between text-zinc-400 font-mono text-[11px]">
              <span>Calibrated Confidence:</span>
              <span className="text-zinc-200 font-bold">{confPct}%</span>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-500 h-full rounded-full transition-all"
                style={{ width: `${confPct}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-500 pt-0.5">
              Health factor H = {debate.healthFactor} scaling
            </p>
          </div>

          <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/80 space-y-1">
            <div className="flex items-center justify-between text-zinc-400 font-mono text-[11px]">
              <span>Disagreement Dispersion:</span>
              <span className="text-zinc-200 font-bold">σ = {debate.dispersion}</span>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.round(debate.dispersion * 500))}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-500 pt-0.5">
              Weighted dispersion across 4 participants
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
