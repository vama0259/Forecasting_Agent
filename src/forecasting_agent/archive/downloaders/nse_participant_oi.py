# Downloader for NSE participant-wise open interest CSV reports.

import time
from datetime import date

import httpx

from forecasting_agent.archive.downloaders.base import Downloader
from forecasting_agent.archive.errors import SourceUnavailableError

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


class NseParticipantOiDownloader(Downloader):
    # Downloads daily participant-wise derivative open interest reports from NSE archives.

    def fetch_raw(self, observed_on: date) -> bytes:
        # Fetches raw CSV bytes for participant OI on observed_on date.
        date_str = observed_on.strftime("%d%m%Y")
        url = f"https://archives.nseindia.com/content/nsccl/fao_participant_oi_{date_str}.csv"
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
                    raise SourceUnavailableError(f"Participant OI not found: {url}")
                if resp.status_code >= 500:
                    if attempt == 2:
                        resp.raise_for_status()
                    continue
                resp.raise_for_status()
            except (httpx.TransportError, httpx.TimeoutException):
                if attempt == 2:
                    raise
        raise SourceUnavailableError(f"Failed to fetch participant OI: {url}")
