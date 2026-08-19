# Plugin parsing participant-wise open interest derivative flow archives.

import csv
import io
import logging
from datetime import date

from forecasting_agent.archive.downloaders.nse_participant_oi import NseParticipantOiDownloader
from forecasting_agent.archive.store import ObservationStore
from forecasting_agent.data_server.connectors import ArchiveDerivedPlugin
from forecasting_agent.data_server.contracts import FlowRecord

logger = logging.getLogger(__name__)


class FlowsPlugin(ArchiveDerivedPlugin):
    # Plugin parsing participant-wise derivative open interest archive data into FlowRecord models.

    def __init__(self, downloader: NseParticipantOiDownloader | None = None) -> None:
        self._downloader = downloader

    def fetch(self, observed_on: date) -> list[FlowRecord]:
        # Fetches and parses participant open interest records for given observed_on date.
        store = ObservationStore()
        content = store.read(source="participant_oi", observed_on=observed_on)
        if content is None:
            try:
                downloader = self._downloader or NseParticipantOiDownloader()
                content = downloader.fetch_raw(observed_on)
                store.write(source="participant_oi", observed_on=observed_on, content=content)
            except Exception as exc:
                logger.debug("Failed on-demand fetch of participant OI for %s: %s", observed_on, exc)
                return []

        text = content.decode("utf-8", errors="replace")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        header_idx = -1
        for i, line in enumerate(lines):
            if "Client Type" in line:
                header_idx = i
                break
        if header_idx == -1:
            return []

        csv_content = "\n".join(lines[header_idx:])
        reader = csv.reader(io.StringIO(csv_content))
        raw_header = next(reader, None)
        if not raw_header:
            return []
        header = [col.strip() for col in raw_header]
        records: list[FlowRecord] = []
        for raw_row in reader:
            if not raw_row:
                continue
            row = {k: v.strip() for k, v in zip(header, raw_row, strict=False) if k}
            participant = row.get("Client Type", "")
            if not participant:
                continue
            try:
                records.append(
                    FlowRecord(
                        observed_on=observed_on,
                        participant=participant,  # type: ignore[arg-type]
                        future_index_long=int(row.get("Future Index Long", 0) or 0),
                        future_index_short=int(row.get("Future Index Short", 0) or 0),
                        future_stock_long=int(row.get("Future Stock Long", 0) or 0),
                        future_stock_short=int(row.get("Future Stock Short", 0) or 0),
                        option_index_call_long=int(row.get("Option Index Call Long", 0) or 0),
                        option_index_put_long=int(row.get("Option Index Put Long", 0) or 0),
                        option_index_call_short=int(row.get("Option Index Call Short", 0) or 0),
                        option_index_put_short=int(row.get("Option Index Put Short", 0) or 0),
                        option_stock_call_long=int(row.get("Option Stock Call Long", 0) or 0),
                        option_stock_put_long=int(row.get("Option Stock Put Long", 0) or 0),
                        option_stock_call_short=int(row.get("Option Stock Call Short", 0) or 0),
                        option_stock_put_short=int(row.get("Option Stock Put Short", 0) or 0),
                        total_long_contracts=int(row.get("Total Long Contracts", 0) or 0),
                        total_short_contracts=int(row.get("Total Short Contracts", 0) or 0),
                    )
                )
            except (ValueError, TypeError):
                continue
        return records


__all__ = ["FlowsPlugin"]
