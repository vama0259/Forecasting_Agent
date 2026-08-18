# Downloader for NSE Bhavcopy market reports with UDiFF and legacy fallback.

import time
from datetime import date

import httpx

from forecasting_agent.archive.downloaders.base import Downloader
from forecasting_agent.archive.errors import SourceUnavailableError

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _backoff_sleep(attempt: int) -> None:
    if attempt == 1:
        time.sleep(2)
    elif attempt == 2:
        time.sleep(4)


class NseBhavcopyDownloader(Downloader):
    # Downloads daily bhavcopy archives for CM or FO market segments.

    def __init__(self, segment: str) -> None:
        # Initializes downloader with segment type CM or FO.
        self.segment = segment.upper()

    def _fetch_url(self, url: str) -> bytes:
        # Downloads binary payload from given URL with retries for transient errors.
        headers = {"User-Agent": USER_AGENT}
        for attempt in range(3):
            _backoff_sleep(attempt)
            try:
                resp = httpx.get(url, headers=headers, timeout=30.0)
                if resp.status_code == 200:
                    return resp.content
                if resp.status_code == 404:
                    raise SourceUnavailableError(f"Bhavcopy not found: {url}")
                if resp.status_code < 500 or attempt == 2:
                    resp.raise_for_status()
            except (httpx.TransportError, httpx.TimeoutException):
                if attempt == 2:
                    raise
        raise SourceUnavailableError(f"Failed to fetch bhavcopy: {url}")

    def fetch_raw(self, observed_on: date) -> bytes:
        # Fetches raw zipped bhavcopy bytes trying UDiFF endpoint first then legacy fallback.
        segment_lower = self.segment.lower()
        date_udiff = observed_on.strftime("%Y%m%d")
        udiff_url = f"https://nsearchives.nseindia.com/content/{segment_lower}/BhavCopy_NSE_{self.segment}_0_0_0_{date_udiff}_F_0000.csv.zip"

        year = observed_on.strftime("%Y")
        month = observed_on.strftime("%b").upper()
        date_legacy = observed_on.strftime("%d%b%Y").upper()
        if self.segment == "CM":
            legacy_url = f"https://nsearchives.nseindia.com/content/historical/EQUITIES/{year}/{month}/cm{date_legacy}bhav.csv.zip"
        else:
            legacy_url = f"https://nsearchives.nseindia.com/content/historical/DERIVATIVES/{year}/{month}/fo{date_legacy}bhav.csv.zip"

        try:
            return self._fetch_url(udiff_url)
        except SourceUnavailableError:
            return self._fetch_url(legacy_url)
