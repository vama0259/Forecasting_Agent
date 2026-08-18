// Checkpoint timeline component rendering the 4 debate rounds with distinct R3 challenge styling
"use client";

import React from "react";
import type { DebateEvent } from "@/lib/mock-debate/types";
import { cn } from "@/lib/utils";
import { CheckCircle2Icon, CircleDotIcon, FlameIcon, ScaleIcon, UsersIcon, ShieldAlertIcon } from "lucide-react";

export interface CheckpointTimelineProps {
  events?: DebateEvent[];
  activeRoundIndex?: number;
  currentRound?: number;
}

interface RoundMeta {
  roundIndex: 1 | 2 | 3 | 4;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ROUND_DEFINITIONS: RoundMeta[] = [
  { roundIndex: 1, label: "Round 1: Independent", sublabel: "Feature & Model Training", icon: UsersIcon },
  { roundIndex: 2, label: "Round 2: Peer Debate", sublabel: "Adversarial Cross-Exams", icon: ShieldAlertIcon },
  { roundIndex: 3, label: "Round 3: Devil's Advocate", sublabel: "Tail-Risk Stress Test", icon: FlameIcon },
  { roundIndex: 4, label: "Round 4: Consensus", sublabel: "Deterministic Math", icon: ScaleIcon },
];

export function CheckpointTimeline({ events = [], activeRoundIndex, currentRound }: CheckpointTimelineProps) {
  const startedRounds = new Set(
    (events || [])
      .filter((e): e is Extract<DebateEvent, { type: "round-start" }> => e.type === "round-start")
      .map((e) => e.roundIndex)
  );

  const activeIndex = currentRound ?? activeRoundIndex ?? Math.max(1, ...Array.from(startedRounds), 1);

  return (
    <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-2.5 py-3 px-4 rounded-xl border border-zinc-800 bg-zinc-950/80 shadow-md">
      {ROUND_DEFINITIONS.map((def) => {
        const isPassed = activeIndex > def.roundIndex;
        const isCurrent = activeIndex === def.roundIndex;
        const isR3 = def.roundIndex === 3;
        const Icon = def.icon;

        const roundAccentStyle: React.CSSProperties = isR3
          ? { ["--round-accent" as string]: "var(--round-challenge, #ef4444)" }
          : { ["--round-accent" as string]: "var(--muted-foreground, #71717a)" };

        return (
          <div
            key={def.roundIndex}
            data-testid={`checkpoint-round-${def.roundIndex}`}
            style={roundAccentStyle}
            className={cn(
              "flex items-center gap-2.5 p-2 rounded-lg border transition-all",
              isCurrent
                ? isR3
                  ? "bg-red-500/10 border-red-500/50 text-red-300 ring-1 ring-red-500/30"
                  : "bg-emerald-500/10 border-emerald-500/50 text-emerald-300 ring-1 ring-emerald-500/30"
                : isPassed
                ? "bg-zinc-900/60 border-zinc-800 text-zinc-300"
                : "bg-zinc-950/40 border-zinc-900 text-zinc-600"
            )}
          >
            <div
              className={cn(
                "p-1.5 rounded-md",
                isCurrent
                  ? isR3
                    ? "bg-red-500/20 text-red-400"
                    : "bg-emerald-500/20 text-emerald-400"
                  : isPassed
                  ? "bg-zinc-800 text-emerald-400"
                  : "bg-zinc-900 text-zinc-600"
              )}
            >
              {isPassed ? (
                <CheckCircle2Icon className="w-4 h-4 text-emerald-400" />
              ) : isCurrent ? (
                <CircleDotIcon className="w-4 h-4 animate-pulse" />
              ) : (
                <Icon className="w-4 h-4" />
              )}
            </div>

            <div className="flex flex-col">
              <span className="text-xs font-semibold leading-tight">{def.label}</span>
              <span className="text-[10px] text-zinc-500 line-clamp-1">{def.sublabel}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
