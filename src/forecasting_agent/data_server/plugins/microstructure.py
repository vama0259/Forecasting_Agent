# Plugin parsing delivery position and bulk/block deal archive data.

import csv
import io
from datetime import date

from forecasting_agent.archive.store import ObservationStore
from forecasting_agent.data_server.connectors import ArchiveDerivedPlugin
from forecasting_agent.data_server.contracts import (
    BlockDealRecord,
    BulkDealRecord,
    DeliveryRecord,
    MicrostructureResponse,
)


class MicrostructurePlugin(ArchiveDerivedPlugin):
    # Plugin parsing delivery and deal microstructure archives into typed response models.

    @staticmethod
    def _parse_delivery(content: bytes, observed_on: date) -> list[DeliveryRecord]:
        text = content.decode("utf-8", errors="replace")
        lines = text.splitlines()
        header_idx = -1
        for i, line in enumerate(lines):
            if "Record Type" in line and "Name of Security" in line:
                header_idx = i
                break
        if header_idx == -1:
            return []

        csv_content = "\n".join(lines[header_idx:])
        reader = csv.DictReader(io.StringIO(csv_content))
        records: list[DeliveryRecord] = []
        for row in reader:
            symbol = row.get("Name of Security", "").strip()
            series = row.get("Series", "").strip()
            if not symbol or not series:
                continue
            qty = int(row.get("Quantity Traded", 0))
            deliv_qty = int(row.get("Deliverable Quantity(gross across client level)", 0))
            deliv_pct = float(row.get("% of Deliverable Quantity to Traded Quantity", 0.0))
            records.append(
                DeliveryRecord(
                    observed_on=observed_on,
                    symbol=symbol,
                    series=series,
                    quantity_traded=qty,
                    deliverable_quantity=deliv_qty,
                    delivery_pct=deliv_pct,
                )
            )
        return records

    @staticmethod
    def _parse_deals(content: bytes, observed_on: date) -> list[BulkDealRecord]:
        text = content.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        records: list[BulkDealRecord] = []
        for row in reader:
            date_val = row.get("Date", "").strip()
            if date_val == "NO RECORDS" or not date_val:
                continue
            symbol = row.get("Symbol", "").strip()
            if not symbol:
                continue
            client_name = row.get("Client Name", "").strip()
            buy_sell = row.get("Buy/Sell", "").strip().upper()
            if buy_sell not in ("BUY", "SELL"):
                continue
            qty = int(row.get("Quantity Traded", "0").replace(",", "").strip())
            price = float(row.get("Trade Price / Wght. Avg. Price", "0.0").replace(",", "").strip())
            records.append(
                BulkDealRecord(
                    observed_on=observed_on,
                    symbol=symbol,
                    client_name=client_name,
                    buy_sell=buy_sell,  # type: ignore[arg-type]
                    quantity=qty,
                    price=price,
                )
            )
        return records

    def fetch(self, observed_on: date) -> MicrostructureResponse:
        # Fetches and parses delivery and bulk/block deal records for given observed_on date.
        store = ObservationStore()
        delivery_content = store.read(source="delivery_position", observed_on=observed_on)
        bulk_content = store.read(source="bulk_deals", observed_on=observed_on)
        block_content = store.read(source="block_deals", observed_on=observed_on)

        missing: list[str] = []
        if delivery_content is None:
            missing.append("delivery_position")
        if bulk_content is None:
            missing.append("bulk_deals")
        if block_content is None:
            missing.append("block_deals")

        delivery_records: list[DeliveryRecord] = []
        if delivery_content is not None:
            delivery_records = self._parse_delivery(delivery_content, observed_on)

        bulk_records: list[BulkDealRecord] = []
        if bulk_content is not None:
            bulk_records = self._parse_deals(bulk_content, observed_on)

        block_records: list[BlockDealRecord] = []
        if block_content is not None:
            raw_block = self._parse_deals(block_content, observed_on)
            block_records = [
                BlockDealRecord(
                    observed_on=r.observed_on,
                    symbol=r.symbol,
                    client_name=r.client_name,
                    buy_sell=r.buy_sell,
                    quantity=r.quantity,
                    price=r.price,
                )
                for r in raw_block
            ]

        coverage_note = f"Absent sources: {', '.join(missing)}" if missing else None

        return MicrostructureResponse(
            observed_on=observed_on,
            delivery=delivery_records,
            bulk_deals=bulk_records,
            block_deals=block_records,
            coverage_note=coverage_note,
        )


__all__ = ["MicrostructurePlugin"]
