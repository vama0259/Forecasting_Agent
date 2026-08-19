# Tests MicrostructurePlugin parses delivery/bulk/block archive sources into typed records.

from datetime import date
from unittest.mock import patch


@patch("forecasting_agent.data_server.plugins.microstructure.ObservationStore")
def test_fetch_parses_all_three_sources_when_present(mock_store_cls):
    delivery_fixture = (
        b"Security Wise Delivery Position - Compulsory Rolling Settlement\n"
        b"10,MTO,14082026,1636546147,0003186\n"
        b"Trade Date <14-AUG-2026>,Settlement Type <N>\n"
        b"Record Type,Sr No,Name of Security,Quantity Traded,"
        b"Deliverable Quantity(gross across client level),% of Deliverable Quantity to Traded Quantity\n"
        b"20,1,TCS,EQ,2232160,1141107,51.12\n"
        b"20,2,RELIANCE,EQ,1000,600,60.00\n"
    )
    bulk_fixture = (
        b"Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price,Remarks\n"
        b"14-AUG-2026,AGIIL,Agi Infra Limited,ARIHANT CAPITAL,BUY,841254,302.04,-\n"
    )
    block_fixture = (
        b"Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price\n"
        b"NO RECORDS,,,,,,\n"
    )

    mock_store = mock_store_cls.return_value
    mock_store.read.side_effect = lambda source, observed_on: {
        "delivery_position": delivery_fixture,
        "bulk_deals": bulk_fixture,
        "block_deals": block_fixture,
    }[source]

    from forecasting_agent.data_server.plugins.microstructure import MicrostructurePlugin

    resp = MicrostructurePlugin().fetch(date(2026, 8, 14))

    assert len(resp.delivery) == 2
    tcs = next(r for r in resp.delivery if r.symbol == "TCS")
    assert tcs.series == "EQ"
    assert tcs.quantity_traded == 2232160
    assert tcs.deliverable_quantity == 1141107
    assert tcs.delivery_pct == 51.12
    assert len(resp.bulk_deals) == 1
    assert resp.bulk_deals[0].symbol == "AGIIL"
    assert resp.block_deals == []
    assert resp.coverage_note is None


@patch("forecasting_agent.data_server.plugins.microstructure.ObservationStore")
def test_fetch_sets_coverage_note_when_a_source_was_never_archived(mock_store_cls):
    mock_store = mock_store_cls.return_value
    mock_store.read.return_value = None
    from unittest.mock import MagicMock

    mock_dl = MagicMock()
    mock_dl.fetch_raw.side_effect = Exception("No delivery data")

    from forecasting_agent.data_server.plugins.microstructure import MicrostructurePlugin

    resp = MicrostructurePlugin(delivery_downloader=mock_dl).fetch(date(2020, 1, 1))

    assert resp.delivery == []
    assert resp.bulk_deals == []
    assert resp.block_deals == []
    assert resp.coverage_note is not None
