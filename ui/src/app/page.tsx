// Multi-Agent Adversarial Debate Viewer & Transparency Dashboard
"use client";

import React, { useEffect, useState, useCallback } from "react";
import type { FullDebateSummary, ParticipantAgentId, DebateStreamEvent, PythonScriptArtifact } from "@/lib/debate/types";
import { mockDebateSummary, samplePythonScripts } from "@/lib/debate/fixtures";
import { SymbolHeader } from "@/components/debate/symbol-header";
import { CheckpointTimeline } from "@/components/debate/checkpoint-timeline";
import { AgentCard } from "@/components/debate/agent-card";
import { ConsensusDigest } from "@/components/debate/consensus-digest";
import { DebateCharts } from "@/components/debate/debate-charts";
import { ScriptBrowser } from "@/components/debate/script-browser";
import { PeerCritiquesMatrix } from "@/components/debate/peer-critiques-matrix";
import { DevilsAdvocatePanel } from "@/components/debate/devils-advocate-panel";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  LineChartIcon,
  FileCode2Icon,
  SwordsIcon,
  FlameIcon,
  TerminalIcon,
  LayersIcon,
  ShieldCheckIcon,
} from "lucide-react";

const PARTICIPANTS: ParticipantAgentId[] = ["price", "fii", "dii", "retail"];

export default function Page() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>("SBIFUNDS.NS");
  const [debate, setDebate] = useState<FullDebateSummary>(mockDebateSummary);
  const [currentRoundIndex, setCurrentRoundIndex] = useState<1 | 2 | 3 | 4>(4);
  const [activeAgent, setActiveAgent] = useState<ParticipantAgentId | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"charts" | "scripts" | "critiques" | "devilsAdvocate" | "reasoning">("charts");
  const [streamingReasoning, setStreamingReasoning] = useState<Record<ParticipantAgentId, string>>({
    price: "",
    fii: "",
    dii: "",
    retail: "",
  });
  const [collectedScripts, setCollectedScripts] = useState<PythonScriptArtifact[]>(samplePythonScripts);

  // Fetch initial debate from PostgreSQL API
  const loadDebateData = useCallback((symbol: string) => {
    fetch(`/api/debates?symbol=${encodeURIComponent(symbol)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.debates && data.debates.length > 0) {
          setDebate(data.debates[0]);
          if (data.debates[0].scripts) {
            setCollectedScripts(data.debates[0].scripts);
          }
        }
      })
      .catch((err) => {
        console.error("Error loading debates:", err);
      });
  }, []);

  useEffect(() => {
    loadDebateData(selectedSymbol);
  }, [selectedSymbol, loadDebateData]);

  // Run Live 4-Round Debate over Server-Sent Events (SSE)
  const handleRunLiveDebate = () => {
    setIsStreaming(true);
    setCurrentRoundIndex(1);
    setActiveAgent("price");
    setStreamingReasoning({ price: "", fii: "", dii: "", retail: "" });

    const eventSource = new EventSource(`/api/debate/stream?symbol=${encodeURIComponent(selectedSymbol)}`);

    eventSource.onmessage = (event) => {
      try {
        const data: DebateStreamEvent = JSON.parse(event.data);

        if (data.type === "round-start") {
          setCurrentRoundIndex(data.roundIndex);
        } else if (data.type === "agent-turn-start") {
          setActiveAgent(data.agent);
        } else if (data.type === "reasoning-token") {
          setStreamingReasoning((prev) => ({
            ...prev,
            [data.agent]: (prev[data.agent] || "") + "\n" + data.token,
          }));
        } else if (data.type === "sandbox-execution") {
          setCollectedScripts((prev) => {
            const exists = prev.some((s) => s.fileName === data.script.fileName);
            if (exists) return prev;
            return [data.script, ...prev];
          });
        } else if (data.type === "consensus-resolved") {
          setCurrentRoundIndex(4);
          setActiveAgent(null);
          setDebate((prev) => ({
            ...prev,
            consensusDirection: data.direction,
            consensusProbability: data.probability,
            consensusConfidence: data.confidence,
            dispersion: data.dispersion,
            deadlockStatus: data.deadlockStatus,
            healthFactor: data.healthFactor,
          }));
        } else if (data.type === "round-complete" && data.roundIndex === 4) {
          setIsStreaming(false);
          eventSource.close();
          loadDebateData(selectedSymbol);
        }
      } catch (err) {
        console.error("Error processing stream event:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE stream error:", err);
      setIsStreaming(false);
      eventSource.close();
    };
  };

  const rounds = debate.rounds;

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-black">
      {/* Header Bar */}
      <SymbolHeader
        selectedSymbol={selectedSymbol}
        onSelectSymbol={(sym) => setSelectedSymbol(sym)}
        onRunLiveDebate={handleRunLiveDebate}
        isStreaming={isStreaming}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Checkpoint Timeline */}
        <CheckpointTimeline currentRound={currentRoundIndex} />

        {/* 4-Participant Roster & Executive Consensus Hero Row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* 4-Agent Cards (8 cols on large screens) */}
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PARTICIPANTS.map((agentId) => {
              const r1Signal = rounds.round1?.[agentId];
              const r2Signal = rounds.round2?.[agentId];
              const r3Signal = rounds.round3?.[agentId];
              const latestSignal = r3Signal || r2Signal || r1Signal;

              return (
                <AgentCard
                  key={agentId}
                  agent={agentId}
                  active={activeAgent === agentId}
                  direction={latestSignal?.direction}
                  probability={latestSignal?.probability}
                  confidence={latestSignal?.confidence}
                  degraded={latestSignal?.degraded}
                />
              );
            })}
          </div>

          {/* Executive Consensus Digest (4 cols on large screens) */}
          <div className="lg:col-span-4">
            <ConsensusDigest debate={debate} className="h-full flex flex-col justify-between" />
          </div>
        </div>

        {/* Transparent Multi-Tab Audit Panel */}
        <div className="space-y-3 pt-2">
          {/* Tab Navigation Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <button
                onClick={() => setActiveTab("charts")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all",
                  activeTab === "charts"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                )}
              >
                <LineChartIcon className="w-3.5 h-3.5 text-blue-400" />
                <span>Charts & Probability Shifts</span>
              </button>

              <button
                onClick={() => setActiveTab("scripts")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all",
                  activeTab === "scripts"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                )}
              >
                <FileCode2Icon className="w-3.5 h-3.5 text-emerald-400" />
                <span>Docker Python Scripts & Logs</span>
                <Badge variant="outline" className="text-[10px] ml-1 bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                  {collectedScripts.length}
                </Badge>
              </button>

              <button
                onClick={() => setActiveTab("critiques")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all",
                  activeTab === "critiques"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                )}
              >
                <SwordsIcon className="w-3.5 h-3.5 text-amber-400" />
                <span>Peer Cross-Examinations</span>
              </button>

              <button
                onClick={() => setActiveTab("devilsAdvocate")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all",
                  activeTab === "devilsAdvocate"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                )}
              >
                <FlameIcon className="w-3.5 h-3.5 text-red-500" />
                <span>Devil's Advocate & Tail Risks</span>
              </button>

              <button
                onClick={() => setActiveTab("reasoning")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all",
                  activeTab === "reasoning"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                )}
              >
                <TerminalIcon className="w-3.5 h-3.5 text-purple-400" />
                <span>Live Deliberation Stream</span>
              </button>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
              <ShieldCheckIcon className="w-3.5 h-3.5 text-emerald-400" />
              <span>Zero-LLM Math Consensus Verified</span>
            </div>
          </div>

          {/* Active Tab View */}
          <div className="transition-all">
            {activeTab === "charts" && <DebateCharts debate={debate} />}
            {activeTab === "scripts" && <ScriptBrowser scripts={collectedScripts} />}
            {activeTab === "critiques" && <PeerCritiquesMatrix debate={debate} />}
            {activeTab === "devilsAdvocate" && <DevilsAdvocatePanel debate={debate} />}
            {activeTab === "reasoning" && (
              <Card className="bg-zinc-950 border-zinc-800 text-zinc-200 shadow-xl p-4">
                <CardHeader className="p-0 pb-3 border-b border-zinc-800">
                  <CardTitle className="text-sm font-semibold text-zinc-200">
                    Live Agent Reasoning Tokens & Event Log
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 pt-3 grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                  {PARTICIPANTS.map((agentId) => (
                    <div key={agentId} className="p-3 rounded bg-zinc-900 border border-zinc-800/80">
                      <div className="text-zinc-400 font-bold uppercase mb-1.5 flex items-center justify-between">
                        <span>[{agentId}] Stream:</span>
                        {activeAgent === agentId && (
                          <span className="text-[10px] text-emerald-400 animate-pulse">Streaming</span>
                        )}
                      </div>
                      <div className="text-zinc-300 text-[11px] whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                        {streamingReasoning[agentId] || "Awaiting turn or completed round..."}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
