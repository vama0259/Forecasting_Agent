# Base interface for archive-derived market data plugins.

from abc import ABC, abstractmethod
from datetime import date
from typing import Any


class ArchiveDerivedPlugin(ABC):
    # Abstract plugin contract fetching parsed records from archive for a date.

    @abstractmethod
    def fetch(self, observed_on: date) -> Any:
        # Fetches parsed records from archive for given observed_on date.
        pass


__all__ = ["ArchiveDerivedPlugin"]
