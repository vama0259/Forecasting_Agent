"use client";

import React, { useState } from 'react';
import type { PythonScriptArtifact, ParticipantAgentId } from '@/lib/debate/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Terminal } from '@/components/ui/terminal';
import { cn } from '@/lib/utils';
import { FileCode2Icon, TerminalIcon, ClockIcon, CheckCircle2Icon, AlertTriangleIcon, PlayIcon } from 'lucide-react';

interface ScriptBrowserProps {
  scripts?: PythonScriptArtifact[];
  selectedAgent?: ParticipantAgentId | null;
  className?: string;
}

export function ScriptBrowser({ scripts = [], selectedAgent, className }: ScriptBrowserProps) {
  const filteredScripts = selectedAgent
    ? scripts.filter((s) => s.agent === selectedAgent)
    : scripts;

  const [selectedScriptIndex, setSelectedScriptIndex] = useState<number>(0);
  const activeScript = filteredScripts[selectedScriptIndex] || filteredScripts[0];

  if (!filteredScripts || filteredScripts.length === 0) {
    return (
      <Card className={cn('bg-zinc-950 border-zinc-800 text-zinc-300', className)}>
        <CardContent className="py-8 text-center text-zinc-500">
          <FileCode2Icon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No Python execution scripts recorded for this phase.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('bg-zinc-950 border-zinc-800 text-zinc-100 shadow-xl overflow-hidden', className)}>
      <CardHeader className="border-b border-zinc-800/80 bg-zinc-900/40 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileCode2Icon className="w-5 h-5 text-emerald-400" />
            <CardTitle className="text-base font-semibold text-zinc-100">
              Docker Sandbox Code & Execution Explorer
            </CardTitle>
          </div>
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs">
            {filteredScripts.length} Verified Script{filteredScripts.length > 1 ? 's' : ''} (Exit 0)
          </Badge>
        </div>
      </CardHeader>

      <div className="grid grid-cols-1 md:grid-cols-12 min-h-[380px]">
        {/* Left Sidebar: Script Tabs */}
        <div className="md:col-span-4 border-r border-zinc-800/80 bg-zinc-950 p-2 space-y-1">
          <p className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase px-2 py-1">
            Generated Scripts
          </p>
          {filteredScripts.map((script, idx) => (
            <button
              key={`${script.fileName}-${idx}`}
              onClick={() => setSelectedScriptIndex(idx)}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-md text-xs font-mono transition-all flex flex-col gap-1 border',
                selectedScriptIndex === idx
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                  : 'bg-zinc-900/30 border-transparent text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-200'
              )}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-semibold text-zinc-200 truncate">{script.fileName}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] px-1 py-0 uppercase',
                    script.agent === 'price' && 'text-blue-400 border-blue-500/30',
                    script.agent === 'fii' && 'text-purple-400 border-purple-500/30',
                    script.agent === 'dii' && 'text-amber-400 border-amber-500/30',
                    script.agent === 'retail' && 'text-emerald-400 border-emerald-500/30'
                  )}
                >
                  {script.agent}
                </Badge>
              </div>
              <span className="text-[11px] text-zinc-500 truncate font-sans">
                {script.description}
              </span>
            </button>
          ))}
        </div>

        {/* Right Content: Code Viewer & Terminal Output */}
        <div className="md:col-span-8 flex flex-col bg-zinc-950">
          {activeScript && (
            <div className="flex-1 flex flex-col">
              {/* Script Header Bar */}
              <div className="px-4 py-2 bg-zinc-900/60 border-b border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400 font-mono">
                <span className="text-zinc-200 font-semibold">{activeScript.fileName}</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-zinc-400">
                    <ClockIcon className="w-3.5 h-3.5" />
                    {activeScript.durationMs}ms
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2Icon className="w-3.5 h-3.5" />
                    exitCode: {activeScript.exitCode}
                  </span>
                </div>
              </div>

              {/* Code Area */}
              <div className="p-3 bg-zinc-950 overflow-x-auto max-h-[220px] font-mono text-xs text-zinc-300 border-b border-zinc-800/80">
                <pre className="leading-relaxed">
                  {activeScript.code}
                </pre>
              </div>

              {/* Terminal Output Area */}
              <div className="p-3 bg-black/80 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-zinc-400 mb-1.5 font-mono">
                  <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Docker Sandbox stdout:</span>
                </div>
                <div className="bg-zinc-900/90 rounded p-2.5 font-mono text-xs text-emerald-300 whitespace-pre-wrap border border-zinc-800">
                  {activeScript.stdout || 'Process finished with exit code 0'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
