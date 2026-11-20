"""Keep every test's new activity journal away from installed service state."""
import pytest


@pytest.fixture(autouse=True)
def synthetic_activity(monkeypatch, tmp_path):
    monkeypatch.setenv('MAIL_ACTIVITY', str(tmp_path / 'activity' / 'calls.jsonl'))
