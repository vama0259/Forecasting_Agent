# Base interface for raw point-in-time observation data downloaders.

from abc import ABC, abstractmethod
from datetime import date


class Downloader(ABC):
    # Abstract downloader contract fetching raw observation bytes for a specific date.

    @abstractmethod
    def fetch_raw(self, observed_on: date) -> bytes:
        # Fetches raw bytes for given observed_on date or raises SourceUnavailableError on 404.
        pass
