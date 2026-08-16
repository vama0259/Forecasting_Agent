# Downloader for NSE bulk and block deal reports.

import time
from datetime import date

import httpx

from forecasting_agent.archive.errors import SourceUnavailableError

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


class NseBulkBlockDealsDownloader:
    # Downloads daily bulk and block deal reports from NSE archives.

    def _fetch_url(self, url: str) -> bytes:
        headers = {"User-Agent": USER_AGENT}
        for attempt in range(3):
            if attempt == 1:
                time.sleep(2)
            elif attempt == 2:
                time.sleep(4)
            try:
                resp = httpx.get(url, headers=headers, timeout=30.0)
                if resp.status_code == 200:
                    return resp.content
                if resp.status_code == 404:
                    raise SourceUnavailableError(f"Deals report not found: {url}")
                if resp.status_code >= 500:
                    if attempt == 2:
                        resp.raise_for_status()
                    continue
                resp.raise_for_status()
            except (httpx.TransportError, httpx.TimeoutException):
                if attempt == 2:
                    raise
        raise SourceUnavailableError(f"Failed to fetch deals report: {url}")

    def fetch_bulk(self, observed_on: date) -> bytes:
        # Fetches raw CSV bytes for bulk deals on observed_on date.
        return self._fetch_url("https://archives.nseindia.com/content/equities/bulk.csv")

    def fetch_block(self, observed_on: date) -> bytes:
        # Fetches raw CSV bytes for block deals on observed_on date.
        return self._fetch_url("https://archives.nseindia.com/content/equities/block.csv")
