// Agent card component rendering agent identity, role, conviction, and capability degradation status
"use client";

import React, { useEffect, useState } from "react";
import type { ParticipantAgentId, DebateAgentId } from "@/lib/debate/types";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TrendingDownIcon,
  TrendingUpIcon,
  LineChartIcon,
  LandmarkIcon,
  Building2Icon,
  UsersIcon,
  ShieldAlertIcon,
  CheckCircle2Icon,
} from "lucide-react";

export interface AgentCardProps {
  agent: DebateAgentId | string;
  active: boolean;
  roleDescription?: string;
  direction?: 'up' | 'down';
  probability?: number;
  confidence?: number;
  degraded?: boolean;
  className?: string;
}

const AGENT_DISPLAY_MAP: Record<
  string,
  { name: string; icon: React.ComponentType<{ className?: string }>; role: string; color: string }
> = {
  price: {
    name: "Price Action Anchor",
    icon: LineChartIcon,
    role: "OHLCV, Moving Averages, Fibonacci & Kalman Trend",
    color: "border-blue-500/40 text-blue-400 bg-blue-500/10",
  },
  fii: {
    name: "FII Derivative Intent",
    icon: LandmarkIcon,
    role: "Index Futures Long/Short & Foreign Institutional Flows",
    color: "border-purple-500/40 text-purple-400 bg-purple-500/10",
  },
  dii: {
    name: "DII Liquidity Support",
    icon: Building2Icon,
    role: "Domestic Mutual Fund Absorption & Counter-Cyclical Bids",
    color: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  },
  retail: {
    name: "Retail Microstructure",
    icon: UsersIcon,
    role: "Bhavcopy Delivery %, Option Chain PCR & Sentiment",
    color: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  },
  technical: {
    name: "Technical",
    icon: LineChartIcon,
    role: "Momentum & Price Action",
    color: "border-blue-500/40 text-blue-400 bg-blue-500/10",
  },
  sentiment: {
    name: "Sentiment",
    icon: UsersIcon,
    role: "News & Sentiment",
    color: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  },
  macro: {
    name: "Macro",
    icon: LandmarkIcon,
    role: "Macro Flows",
    color: "border-purple-500/40 text-purple-400 bg-purple-500/10",
  },
};

export function AgentCard({
  agent,
  active,
  roleDescription,
  direction,
  probability,
  confidence,
  degraded,
  className,
}: AgentCardProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const meta = AGENT_DISPLAY_MAP[agent] || {
    name: agent.toUpperCase(),
    icon: LineChartIcon,
    role: "Specialist Sub-Agent",
    color: "border-zinc-700 text-zinc-300 bg-zinc-800",
  };
  const Icon = meta.icon;

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);

      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, []);

  return (
    <div
      className={cn(
        "rounded-xl border transition-all p-3.5 bg-zinc-950/90 shadow-md relative overflow-hidden flex flex-col justify-between",
        active ? "border-emerald-500 ring-2 ring-emerald-500/30 bg-zinc-900/90" : "border-zinc-800",
        className
      )}
    >
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded-lg border", meta.color)}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-xs text-zinc-100 uppercase tracking-wide">
                [{agent}] {meta.name}
              </h3>
              <p className="text-[10px] text-zinc-400 font-sans line-clamp-1">
                {roleDescription || meta.role}
              </p>
            </div>
          </div>
          {active && !prefersReducedMotion && (
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] animate-pulse">
              Thinking
            </Badge>
          )}
        </div>

        {/* Conviction & Probability Bar */}
        {probability !== undefined && (
          <div className="mt-3 pt-2.5 border-t border-zinc-800/80 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[10px] text-zinc-500 uppercase font-mono">Direction:</span>
              <div className="flex items-center gap-1 font-bold">
                {direction === 'up' ? (
                  <span className="text-emerald-400 flex items-center gap-0.5">
                    <TrendingUpIcon className="w-3.5 h-3.5" /> UP ({Math.round(probability * 100)}%)
                  </span>
                ) : (
                  <span className="text-red-400 flex items-center gap-0.5">
                    <TrendingDownIcon className="w-3.5 h-3.5" /> DOWN ({Math.round(probability * 100)}%)
                  </span>
                )}
              </div>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 uppercase font-mono">Confidence:</span>
              <div className="text-zinc-200 font-mono font-semibold">
                {confidence ? `${Math.round(confidence * 100)}%` : 'N/A'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Degradation Alert if capability fencing was triggered */}
      {degraded && (
        <div className="mt-2.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 flex items-center gap-1.5 text-[10px] text-amber-300">
          <ShieldAlertIcon className="w-3 h-3 text-amber-400 shrink-0" />
          <span>Degraded: 0.5× voting haircut applied</span>
        </div>
      )}

      {active && !prefersReducedMotion && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-emerald-500 to-teal-400 animate-pulse" />
      )}
    </div>
  );
}
