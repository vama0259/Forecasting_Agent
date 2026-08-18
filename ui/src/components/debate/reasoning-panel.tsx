// Reasoning panel component rendering collapsible step-by-step thinking traces for debate turns
"use client";

import React, { useState } from "react";
import type { AgentId } from "@/lib/mock-debate/types";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { cn } from "@/lib/utils";
import { BrainCircuitIcon, Loader2Icon } from "lucide-react";

// Props accepted by the ReasoningPanel component
export interface ReasoningPanelProps {
  agent: AgentId;
  text: string;
  streaming: boolean;
  className?: string;
}

const AGENT_LABELS: Record<AgentId, string> = {
  technical: "Technical",
  sentiment: "Sentiment",
  macro: "Macro",
};

// Renders the expandable reasoning thoughts and analytical deduction for an agent's turn
export function ReasoningPanel({ agent, text, streaming, className }: ReasoningPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const agentLabel = AGENT_LABELS[agent];
  const accentVar = `var(--agent-${agent})`;

  return (
    <div
      style={{ ["--agent-accent" as string]: accentVar }}
      className={cn(
        "rounded-xl border border-border/80 bg-card/60 p-3.5 backdrop-blur-xs transition-colors",
        className
      )}
    >
      <ChainOfThought open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
          <ChainOfThoughtHeader className="text-xs font-mono font-medium hover:text-foreground">
            <span className="flex items-center gap-1.5">
              <BrainCircuitIcon className="size-3.5 text-[var(--agent-accent)]" />
              <span>Reasoning Chain</span>
            </span>
          </ChainOfThoughtHeader>
          {streaming && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-[var(--agent-accent)] bg-[var(--agent-accent)]/10 px-2 py-0.5 rounded border border-[var(--agent-accent)]/30">
              <Loader2Icon className="size-3 animate-spin" />
              streaming
            </span>
          )}
        </div>
        <ChainOfThoughtContent>
          <div className="pt-2 font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
            <ChainOfThoughtStep
              label={<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Internal Monologue</span>}
              status={streaming ? "active" : "complete"}
            >
              <div className="mt-1.5 p-3 rounded-lg bg-background/50 border border-border/40 font-mono text-xs text-foreground/80 leading-relaxed">
                {text || <span className="italic text-muted-foreground/60">Awaiting tokens...</span>}
              </div>
            </ChainOfThoughtStep>
          </div>
        </ChainOfThoughtContent>
      </ChainOfThought>
    </div>
  );
}
