"use client";

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlayIcon, RotateCcwIcon, HistoryIcon, SearchIcon, SparklesIcon } from 'lucide-react';
import type { SymbolOption } from '@/app/api/symbols/route';

interface SymbolHeaderProps {
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onRunLiveDebate: () => void;
  isStreaming: boolean;
  onSelectHistoricalRun?: (forecastId: string) => void;
}

export function SymbolHeader({
  selectedSymbol,
  onSelectSymbol,
  onRunLiveDebate,
  isStreaming,
}: SymbolHeaderProps) {
  const [symbols, setSymbols] = useState<SymbolOption[]>([]);
  const [customInput, setCustomInput] = useState<string>('');

  useEffect(() => {
    fetch('/api/symbols')
      .then((res) => res.json())
      .then((data) => {
        if (data?.symbols) setSymbols(data.symbols);
      })
      .catch(() => {});
  }, []);

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customInput.trim()) {
      let sym = customInput.trim().toUpperCase();
      if (!sym.endsWith('.NS') && !sym.endsWith('.BO')) {
        sym = `${sym}.NS`;
      }
      onSelectSymbol(sym);
      setCustomInput('');
    }
  };

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40 px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        {/* Title & Brand */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <SparklesIcon className="w-5 h-5 text-black font-bold" />
          </div>
          <div>
            <h1 className="text-base font-bold text-zinc-100 flex items-center gap-2">
              Forecasting Agent <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">Adversarial Debate v1.0</Badge>
            </h1>
            <p className="text-xs text-zinc-400">
              4-Round Multi-Agent Deliberation & Deterministic Consensus
            </p>
          </div>
        </div>

        {/* Symbol Quick Select & Custom Search */}
        <div className="flex flex-wrap items-center gap-2.5">
          <form onSubmit={handleCustomSubmit} className="relative flex items-center">
            <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search NSE Ticker..."
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/50 w-44 font-mono"
            />
          </form>

          {/* Quick Presets Dropdown/Buttons */}
          <div className="hidden sm:flex items-center gap-1.5">
            {['SBIFUNDS.NS', 'HDFCBANK.NS', 'TCS.NS'].map((sym) => (
              <button
                key={sym}
                onClick={() => onSelectSymbol(sym)}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all border ${
                  selectedSymbol === sym
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 font-semibold'
                    : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>

          {/* Run Live Forecast Button */}
          <Button
            onClick={onRunLiveDebate}
            disabled={isStreaming}
            className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs px-4 py-2 rounded-lg shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-1.5"
          >
            {isStreaming ? (
              <>
                <RotateCcwIcon className="w-3.5 h-3.5 animate-spin" />
                Deliberating Live...
              </>
            ) : (
              <>
                <PlayIcon className="w-3.5 h-3.5 fill-black" />
                Run 4-Round Debate
              </>
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
