"use client";

import React, { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlayIcon, RotateCcwIcon, SearchIcon, SparklesIcon, ChevronDownIcon, XIcon } from 'lucide-react';
import type { SymbolOption } from '@/app/api/symbols/route';

interface SymbolHeaderProps {
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onRunLiveDebate: () => void;
  isStreaming: boolean;
}

export function SymbolHeader({
  selectedSymbol,
  onSelectSymbol,
  onRunLiveDebate,
  isStreaming,
}: SymbolHeaderProps) {
  const [symbols, setSymbols] = useState<SymbolOption[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/symbols')
      .then((res) => res.json())
      .then((data) => {
        if (data?.symbols) setSymbols(data.symbols);
      })
      .catch(() => {});
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (sym: string) => {
    onSelectSymbol(sym);
    setSearchQuery('');
    setIsOpen(false);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      let sym = searchQuery.trim().toUpperCase();
      if (!sym.endsWith('.NS') && !sym.endsWith('.BO')) {
        sym = `${sym}.NS`;
      }
      handleSelect(sym);
    }
  };

  const filteredSymbols = searchQuery.trim()
    ? symbols.filter(
        (s) =>
          s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.sector.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : symbols.slice(0, 8);

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md sticky top-0 z-50 px-4 py-3">
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

        {/* Stock Search & Autocomplete Dropdown */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div ref={dropdownRef} className="relative">
            <form onSubmit={handleCustomSubmit} className="relative flex items-center">
              <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Search any stock / ticker..."
                value={searchQuery}
                onFocus={() => setIsOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsOpen(true);
                }}
                className="bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/50 w-56 sm:w-64 font-mono transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-zinc-500 hover:text-zinc-300"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </form>

            {/* Dropdown Results */}
            {isOpen && (
              <div className="absolute left-0 mt-1.5 w-72 sm:w-80 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50 max-h-72 overflow-y-auto">
                <div className="p-1.5 border-b border-zinc-800/80 bg-zinc-900/40 text-[10px] uppercase font-mono text-zinc-500 px-2.5">
                  {searchQuery ? `Matching Stocks (${filteredSymbols.length})` : 'Popular NSE Equities'}
                </div>

                {filteredSymbols.length === 0 ? (
                  <div className="p-3 text-center text-xs text-zinc-500">
                    <p>No exact match.</p>
                    <button
                      onClick={handleCustomSubmit}
                      className="mt-1.5 text-emerald-400 hover:underline font-mono text-xs"
                    >
                      Search custom ticker &quot;{searchQuery.toUpperCase()}&quot; →
                    </button>
                  </div>
                ) : (
                  <div className="p-1 space-y-0.5">
                    {filteredSymbols.map((item) => (
                      <button
                        key={item.symbol}
                        onClick={() => handleSelect(item.symbol)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all flex items-center justify-between group ${
                          selectedSymbol === item.symbol
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : 'hover:bg-zinc-900 text-zinc-300'
                        }`}
                      >
                        <div className="flex flex-col">
                          <span className="font-mono font-bold text-zinc-100 group-hover:text-emerald-300">
                            {item.symbol}
                          </span>
                          <span className="text-[11px] text-zinc-400 truncate max-w-[180px]">
                            {item.name}
                          </span>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-sans truncate max-w-[80px]">
                          {item.sector.split('/')[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Preset Buttons */}
          <div className="hidden md:flex items-center gap-1.5">
            {['SBIFUNDS.NS', 'HDFCBANK.NS', 'TCS.NS', 'RELIANCE.NS'].map((sym) => (
              <button
                key={sym}
                onClick={() => handleSelect(sym)}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all border ${
                  selectedSymbol === sym
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 font-semibold'
                    : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                {sym.split('.')[0]}
              </button>
            ))}
          </div>

          {/* Run 4-Round Debate Button */}
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
