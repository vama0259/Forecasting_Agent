# Plugin parsing participant-wise open interest derivative flow archives.

import csv
import io
from datetime import date

from forecasting_agent.archive.store import ObservationStore
from forecasting_agent.data_server.connectors import ArchiveDerivedPlugin
from forecasting_agent.data_server.contracts import FlowRecord


class FlowsPlugin(ArchiveDerivedPlugin):
    # Plugin parsing participant-wise derivative open interest archive data into FlowRecord models.

    def fetch(self, observed_on: date) -> list[FlowRecord]:
        # Fetches and parses participant open interest records for given observed_on date.
        store = ObservationStore()
        content = store.read(source="participant_oi", observed_on=observed_on)
        if content is None:
            return []

        text = content.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        records: list[FlowRecord] = []
        for row in reader:
            participant = row.get("Client Type", "").strip()
            if not participant:
                continue
            records.append(
                FlowRecord(
                    observed_on=observed_on,
                    participant=participant,  # type: ignore[arg-type]
                    future_index_long=int(row.get("Future Index Long", 0)),
                    future_index_short=int(row.get("Future Index Short", 0)),
                    future_stock_long=int(row.get("Future Stock Long", 0)),
                    future_stock_short=int(row.get("Future Stock Short", 0)),
                    option_index_call_long=int(row.get("Option Index Call Long", 0)),
                    option_index_put_long=int(row.get("Option Index Put Long", 0)),
                    option_index_call_short=int(row.get("Option Index Call Short", 0)),
                    option_index_put_short=int(row.get("Option Index Put Short", 0)),
                    option_stock_call_long=int(row.get("Option Stock Call Long", 0)),
                    option_stock_put_long=int(row.get("Option Stock Put Long", 0)),
                    option_stock_call_short=int(row.get("Option Stock Call Short", 0)),
                    option_stock_put_short=int(row.get("Option Stock Put Short", 0)),
                    total_long_contracts=int(row.get("Total Long Contracts", 0)),
                    total_short_contracts=int(row.get("Total Short Contracts", 0)),
                )
            )
        return records


__all__ = ["FlowsPlugin"]
