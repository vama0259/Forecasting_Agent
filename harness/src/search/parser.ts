// Parser converting AnySearch markdown response blobs into structured SearchResult objects.

import type { SearchResult } from './types.js';
import { SearchResponseFormatError } from './types.js';

// Parses unstructured markdown search response blobs from AnySearch into typed search result items.
export class AnySearchResultParser {
  // Parses raw markdown text from AnySearch, returning an array of SearchResult items or throwing on bad format.
  parse(text: string): SearchResult[] {
    const trimmed = text.trim();
    if (trimmed.length === 0 || /^##\s*Search Results \(0 results/i.test(trimmed)) {
      return [];
    }

    const segments = text.split(/^### \d+\. /m);
    const blocks = segments.slice(1);

    if (blocks.length === 0) {
      const snippet = text.slice(0, 120);
      throw new SearchResponseFormatError(`Failed to parse search response format: "${snippet}"`);
    }

    return blocks.map((block, index) => {
      const firstNewline = block.indexOf('\n');
      const title = firstNewline === -1 ? block.trim() : block.slice(0, firstNewline).trim();
      const urlMatch = block.match(/^- \*\*URL\*\*: (\S+)$/m);
      const url = urlMatch ? (urlMatch[1] ?? null) : null;
      let hostname: string | null = null;
      if (url) {
        try {
          hostname = new URL(url).hostname;
        } catch {
          hostname = null;
        }
      }
      return {
        rank: index + 1,
        title,
        url,
        hostname,
        content: block,
      };
    });
  }
}
