# Tests FlowsPlugin parses the real archived participant-OI fixture into typed FlowRecord rows.

from datetime import date
from unittest.mock import patch

from forecasting_agent.data_server.plugins.flows import FlowsPlugin


@patch("forecasting_agent.data_server.plugins.flows.ObservationStore")
def test_fetch_parses_real_fixture_into_flow_records(mock_store_cls):
    fixture = (
        b'""Participant wise Open Interest (no. of contracts) in Equity Derivatives '
        b'as on Aug 14, 2026"",,,,,,,,,,,,,,\r\n'
        b"Client Type,Future Index Long,Future Index Short,Future Stock Long,Future Stock Short       ,"
        b"Option Index Call Long,Option Index Put Long,Option Index Call Short,Option Index Put Short,"
        b"Option Stock Call Long,Option Stock Put Long,Option Stock Call Short,Option Stock Put Short,"
        b"Total Long Contracts      ,Total Short Contracts\r\n"
        b"Client,211638,55956,3275125,261974,3205535,2649873,3072956,3257565,2832221,977719,1540281,1301705,13152111,9490438\r\n"
        b"DII,50830,20040,329392,4402412,7380,50603,130,0,928,40785,352194,19703,479918,4794479\r\n"
        b"FII,25537,202235,3535257,2910988,537355,975053,814000,477877,216502,378403,415544,211113,5668106,5031758\r\n"
        b"Pro,36280,46054,918232,482632,1122941,1024818,986124,964904,1026362,1089505,1767994,953891,5218139,5201599\r\n"
        b"TOTAL,324285,324285,8058006,8058006,4873211,4700347,4873211,4700347,4076013,2486412,4076013,2486412,24518274,24518274\r\n"
    )
    mock_store_cls.return_value.read.return_value = fixture

    records = FlowsPlugin().fetch(date(2026, 8, 14))

    assert len(records) == 5  # Client, DII, FII, Pro, TOTAL
    fii = next(r for r in records if r.participant == "FII")
    assert fii.future_index_short == 202235
    assert fii.future_stock_long == 3535257
    assert fii.total_long_contracts == 5668106

    dii = next(r for r in records if r.participant == "DII")
    assert dii.future_stock_short == 4402412
    assert dii.future_index_long == 50830

    client = next(r for r in records if r.participant == "Client")
    assert client.total_long_contracts == 13152111


@patch("forecasting_agent.data_server.plugins.flows.ObservationStore")
def test_fetch_returns_empty_list_when_archive_has_no_data_for_the_date(mock_store_cls):
    mock_store_cls.return_value.read.return_value = None
    from unittest.mock import MagicMock

    mock_dl = MagicMock()
    mock_dl.fetch_raw.side_effect = Exception("No data available")

    records = FlowsPlugin(downloader=mock_dl).fetch(date(2026, 1, 1))

    assert records == []
