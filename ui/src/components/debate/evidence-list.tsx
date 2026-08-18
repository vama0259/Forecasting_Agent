// Evidence list component rendering citations, reference links, and extracted factual snippets
"use client";

import React, { useState } from "react";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "@/components/ai-elements/sources";
import { cn } from "@/lib/utils";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";

// Props accepted by the EvidenceList component
export interface EvidenceListProps {
  items: Array<{
    source: string;
    url?: string;
    snippet: string;
  }>;
  className?: string;
}

// Renders external data sources and factual research snippets utilized during debate analysis
export function EvidenceList({ items, className }: EvidenceListProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className={cn("rounded-xl border border-border/80 bg-card/60 p-3.5", className)}>
      <Sources open={isOpen} onOpenChange={setIsOpen} className="mb-0 text-foreground">
        <SourcesTrigger count={items.length} className="text-xs font-mono font-medium text-muted-foreground hover:text-foreground mb-2" />
        <SourcesContent className="mt-2 w-full space-y-2.5">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="p-2.5 rounded-lg border border-border/60 bg-background/50 text-xs space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <FileTextIcon className="size-3.5 text-muted-foreground" />
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline hover:text-primary/80 transition-colors"
                    >
                      <span>{item.source}</span>
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  ) : (
                    <span>{item.source}</span>
                  )}
                </div>
              </div>
              <p className="text-muted-foreground leading-relaxed pl-5 font-mono text-[11px]">
                {item.snippet}
              </p>
            </div>
          ))}
        </SourcesContent>
      </Sources>
    </div>
  );
}
