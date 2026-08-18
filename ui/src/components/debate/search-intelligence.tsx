'use client';

import React from 'react';
import { Globe, ExternalLink, ShieldCheck, ShieldAlert, Search, Newspaper, Calendar } from 'lucide-react';
import type { SearchArticleObservation } from '@/lib/debate/types';

interface SearchIntelligenceProps {
  articles?: SearchArticleObservation[];
}

export function SearchIntelligence({ articles = [] }: SearchIntelligenceProps) {
  if (!articles || articles.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-8 text-center backdrop-blur-sm">
        <Newspaper className="mx-auto h-10 w-10 text-zinc-600 mb-3" />
        <h3 className="text-base font-medium text-zinc-300">No Search Observations Yet</h3>
        <p className="mt-1 text-xs text-zinc-500 max-w-md mx-auto">
          When the Retail & Sentiment sub-agent calls AnySearch, the queries, filtered financial articles, and publisher domains will appear here in real-time.
        </p>
      </div>
    );
  }

  const allowlistedCount = articles.filter((a) => a.allowed).length;
  const filteredCount = articles.length - allowlistedCount;

  return (
    <div className="space-y-4">
      {/* Top Search Metrics Banner */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3.5 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-zinc-400">
            <Search className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-medium">Total Captured Queries</span>
          </div>
          <p className="mt-1.5 text-xl font-semibold text-zinc-100">{articles.length}</p>
        </div>

        <div className="rounded-xl border border-emerald-950/50 bg-emerald-950/20 p-3.5 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            <span className="text-xs font-medium">Allowlisted Publishers</span>
          </div>
          <p className="mt-1.5 text-xl font-semibold text-emerald-400">{allowlistedCount}</p>
          <span className="text-[10px] text-emerald-600">ET, Moneycontrol, Livemint, NSE</span>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3.5 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-rose-400">
            <ShieldAlert className="h-4 w-4" />
            <span className="text-xs font-medium">Filtered Domains</span>
          </div>
          <p className="mt-1.5 text-xl font-semibold text-rose-400">{filteredCount}</p>
          <span className="text-[10px] text-zinc-500">Excluded non-allowlisted sites</span>
        </div>
      </div>

      {/* Articles Feed */}
      <div className="space-y-3">
        {articles.map((article) => (
          <div
            key={article.id}
            className="group rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-900/40"
          >
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-mono text-zinc-300">
                  <Search className="h-3 w-3 text-zinc-400" />
                  {article.query}
                </span>
                <span className="text-[10px] text-zinc-500">Rank #{article.resultRank}</span>
              </div>

              <div className="flex items-center gap-2">
                {article.allowed ? (
                  <span className="flex items-center gap-1 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    <ShieldCheck className="h-3 w-3" />
                    Allowlisted
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full border border-rose-900/40 bg-rose-950/30 px-2 py-0.5 text-[10px] font-medium text-rose-400">
                    <ShieldAlert className="h-3 w-3" />
                    Filtered
                  </span>
                )}
                <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                  <Calendar className="h-3 w-3" />
                  {new Date(article.retrievedAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Article Content */}
            <div className="mt-3">
              <h4 className="text-sm font-medium text-zinc-100 group-hover:text-emerald-400 transition-colors">
                {article.title}
              </h4>

              {article.url && (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-500 hover:text-emerald-400 hover:underline break-all"
                >
                  <Globe className="h-3 w-3 shrink-0" />
                  <span>{article.hostname || article.url}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                </a>
              )}

              {article.content && (
                <p className="mt-2 text-xs leading-relaxed text-zinc-400 bg-zinc-900/40 rounded-lg p-2.5 border border-zinc-800/40">
                  {article.content}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
