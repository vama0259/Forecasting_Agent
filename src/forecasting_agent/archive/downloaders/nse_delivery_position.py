# Downloader for NSE security-wise delivery position reports.

import time
from datetime import date

import httpx

from forecasting_agent.archive.downloaders.base import Downloader
from forecasting_agent.archive.errors import SourceUnavailableError

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


class NseDeliveryPositionDownloader(Downloader):
    # Downloads daily security-wise delivery position reports from NSE archives.

    def fetch_raw(self, observed_on: date) -> bytes:
        # Fetches raw DAT bytes for delivery position on observed_on date.
        date_str = observed_on.strftime("%d%m%Y")
        url = f"https://archives.nseindia.com/archives/equities/mto/MTO_{date_str}.DAT"
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
                    raise SourceUnavailableError(f"Delivery position not found: {url}")
                if resp.status_code >= 500:
                    if attempt == 2:
                        resp.raise_for_status()
                    continue
                resp.raise_for_status()
            except (httpx.TransportError, httpx.TimeoutException):
                if attempt == 2:
                    raise
        raise SourceUnavailableError(f"Failed to fetch delivery position: {url}")
