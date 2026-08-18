# Daily archive CLI; run post-market: uv run python -m forecasting_agent.archive.run_daily

import logging
from datetime import date

from forecasting_agent.archive.downloaders.base import Downloader
from forecasting_agent.archive.downloaders.nse_bhavcopy import NseBhavcopyDownloader
from forecasting_agent.archive.downloaders.nse_bulk_block_deals import NseBulkBlockDealsDownloader
from forecasting_agent.archive.downloaders.nse_delivery_position import NseDeliveryPositionDownloader
from forecasting_agent.archive.downloaders.nse_participant_oi import NseParticipantOiDownloader
from forecasting_agent.archive.errors import SourceUnavailableError
from forecasting_agent.archive.store import ObservationStore

logger = logging.getLogger(__name__)


class _BulkDealsAdapter(Downloader):
    # Adapts NseBulkBlockDealsDownloader.fetch_bulk to Downloader interface.

    def __init__(self, downloader: NseBulkBlockDealsDownloader) -> None:
        self._downloader = downloader

    def fetch_raw(self, observed_on: date) -> bytes:
        # Fetches raw bulk deals bytes.
        return self._downloader.fetch_bulk(observed_on)


class _BlockDealsAdapter(Downloader):
    # Adapts NseBulkBlockDealsDownloader.fetch_block to Downloader interface.

    def __init__(self, downloader: NseBulkBlockDealsDownloader) -> None:
        self._downloader = downloader

    def fetch_raw(self, observed_on: date) -> bytes:
        # Fetches raw block deals bytes.
        return self._downloader.fetch_block(observed_on)


def _build_default_downloaders() -> dict[str, Downloader]:
    # Builds standard suite of downloaders for daily archiving runs.
    deals_downloader = NseBulkBlockDealsDownloader()
    return {
        "bhavcopy_cm": NseBhavcopyDownloader("CM"),
        "bhavcopy_fo": NseBhavcopyDownloader("FO"),
        "participant_oi": NseParticipantOiDownloader(),
        "delivery_position": NseDeliveryPositionDownloader(),
        "bulk_deals": _BulkDealsAdapter(deals_downloader),
        "block_deals": _BlockDealsAdapter(deals_downloader),
    }


def run_all_downloaders(store: ObservationStore, downloaders: dict[str, Downloader], observed_on: date) -> None:
    # Executes all configured downloaders for target date and archives payloads or records gaps.
    for name, downloader in downloaders.items():
        try:
            content = downloader.fetch_raw(observed_on)
            store.write(source=name, observed_on=observed_on, content=content)
        except SourceUnavailableError as exc:
            logger.exception("Source %s unavailable on %s: %s", name, observed_on, exc)
            store.write(source=name, observed_on=observed_on, content=None, detail=str(exc))
        except Exception as exc:
            logger.exception("Download failed for source %s on %s: %s", name, observed_on, exc)
            store.write(source=name, observed_on=observed_on, content=None, detail=str(exc))


def main() -> None:
    # Invocable daily entry point configuring default downloaders and current date.
    store = ObservationStore()
    downloaders = _build_default_downloaders()
    run_all_downloaders(store=store, downloaders=downloaders, observed_on=date.today())  # noqa: DTZ011


if __name__ == "__main__":
    main()
