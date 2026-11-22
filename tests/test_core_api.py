"""Web API contract tests with synthetic metadata only; never a live mail store."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import threading
import tomllib
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo
import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from activity import Activity
from allowlist import Allowlist, check_history
import auth_audit
import core_api
from core_api import activity_query, buckets, floor_time, incidents, overview, start_api
from test_allowlist import UnixConnection

NOW = datetime.now(timezone.utc)
ARCHIVE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'


def telemetry(tool, minutes_ago, outcome='ok', error_class=None, requested=1, login=5):
    return {'tool': tool, 'ts': (NOW - timedelta(minutes=minutes_ago)).isoformat(), 'requested': requested,
            'outcome': outcome, 'error_class': error_class, 'total_ms': 12.5, 'phase': {'login': login, 'connect': login}, 'bridge_ok': True}


@pytest.fixture
def store(tmp_path):
    directory = tmp_path / 'policy'
    directory.mkdir(mode=0o700)
    path = directory / 'allowlist.json'
    path.write_text(json.dumps({'version': 1, 'entries': [], 'history': []}))
    path.chmod(0o600)
    return Allowlist(path)


@pytest.fixture
def log(tmp_path):
    activity = Activity(tmp_path / 'activity' / 'activity.jsonl', tmp_path / 'health' / 'health.jsonl')
    refused = {'messages': [{'body': 'x'}, {'refusal': {'code': 'sender_not_allowlisted'}}, {'refusal': {'code': 'sender_not_verified'}}]}
    activity.record(telemetry('read_messages', 60 * 24 * 10, requested=3), refused, {'folder': 'INBOX'})
    activity.record(telemetry('search_messages', 60 * 30, 'timeout', 'deadline'), None, {})
    activity.record(telemetry('archive_messages', 60 * 3, requested=2), {'action_id': ARCHIVE_ID, 'completed': ['1', '2']}, {})
    activity.record(telemetry('read_messages', 50, requested=3), refused, {})
    activity.record(telemetry('list_folders', 5), {'folders': []}, {})
    return activity


def test_calls_carry_ids_and_legacy_rows_get_stable_ones(log):
    rows = log.rows()
    assert all(re.fullmatch(r'[a-f0-9]{32}', r['id']) for r in rows)
    assert len({r['id'] for r in rows}) == len(rows)
    legacy = {k: v for k, v in rows[0].items() if k != 'id'}
    with open(log.path, 'a') as stream:
        stream.write(json.dumps(legacy) + '\n')
    first, second = log.rows()[-1]['id'], log.rows()[-1]['id']
    assert first == second and first != rows[0]['id']


def q(**params):
    return {k: [v] for k, v in params.items()}


def test_activity_filters_page_and_series(log):
    every = activity_query(log, q())
    assert every['total'] == 5 and [r['tool'] for r in every['rows']][0] == 'list_folders'
    assert set(every['rows'][0]) >= {'id', 'time', 'tool', 'outcome', 'counts'}
    assert activity_query(log, q(tool='read_messages,list_folders'))['total'] == 3
    assert activity_query(log, q(outcome='refused'))['total'] == 2
    assert activity_query(log, q(refusals='1'))['total'] == 2
    assert activity_query(log, q(q='not verified'))['total'] == 2
    assert activity_query(log, q(q='timed out'))['total'] == 1
    assert activity_query(log, q(q=ARCHIVE_ID[:8]))['rows'][0]['action_id'] == ARCHIVE_ID
    recent = activity_query(log, q(**{'from': (NOW - timedelta(days=1)).isoformat()}))
    assert recent['total'] == 3 and recent['series']['bucket_seconds'] == 3600
    assert sum(p['ok'] + p['refused'] + p['error'] for p in recent['series']['points']) == 3
    window = activity_query(log, q(**{'from': (NOW - timedelta(days=2)).isoformat(), 'to': (NOW - timedelta(hours=1)).isoformat()}))
    assert [r['tool'] for r in window['rows']] == ['archive_messages', 'search_messages']
    page = activity_query(log, q(offset='1', limit='2'))
    assert len(page['rows']) == 2 and page['truncated'] and page['offset'] == 1
    assert activity_query(log, q())['series']['bucket_seconds'] == 86400


@pytest.mark.parametrize('params', [q(outcome='odd'), q(tool='Bad-Tool'), q(limit='500'), q(offset='-1'), q(**{'from': '2026-01-01'}), {'tool': ['a', 'b']}, q(q='x' * 201)])
def test_activity_rejects_unexpected_parameters(log, params):
    with pytest.raises(ValueError):
        activity_query(log, params)


def test_calendar_buckets_follow_the_callers_zone_across_dst():
    tz = ZoneInfo('America/New_York')
    start = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)
    days = buckets(start, start + timedelta(days=4), 'day', tz)
    assert [d.astimezone(tz).hour for d in days] == [0] * 5
    assert days[2] - days[1] == timedelta(hours=24) and days[3] - days[2] == timedelta(hours=25)
    assert floor_time(datetime(2026, 11, 3, 3, tzinfo=timezone.utc), 'day', tz) == datetime(2026, 11, 2, 5, tzinfo=timezone.utc)
    assert core_api.zone('Not/A_Zone') is timezone.utc and core_api.zone('../etc') is timezone.utc


def test_overview_compares_periods_and_flags_attention(log, store, monkeypatch):
    monkeypatch.delenv('MAIL_TRUSTED_AUTHSERV_ID', raising=False)
    soon = store.edit(changes={'address': 'soon@example.org', 'expires_at': (NOW + timedelta(days=2)).isoformat()})
    store.edit(changes={'address': 'later@example.org', 'expires_at': (NOW + timedelta(days=40)).isoformat()})
    data = store.list()
    data['entries'][0]['matches'] = [{'date': NOW.date().isoformat(), 'count': 4}]
    data['entries'][0]['match_count'] = 4
    store.path.write_text(json.dumps(data))
    value = overview(log, '7d', store, core_api.enforcement_state(store))
    assert value['totals']['calls'] == 4 and value['previous']['calls'] == 1
    assert value['totals']['refusals'] == {'sender_not_allowlisted': 1, 'sender_not_verified': 1}
    assert value['previous']['refusals']['sender_not_allowlisted'] == 1
    assert value['totals']['messages_changed'] == 2
    assert value['top_senders'] == [{'id': soon['id'], 'address': 'soon@example.org', 'matches': 4, 'state': 'expiring'}]
    kinds = [item['kind'] for item in value['attention']]
    assert kinds[0] == 'authserv_missing' and 'expiring' in kinds
    assert all(item['address'] != 'later@example.org' for item in value['attention'] if 'address' in item)
    monkeypatch.setenv('MAIL_TRUSTED_AUTHSERV_ID', 'receiver.example.org')
    assert 'authserv_missing' not in [i['kind'] for i in overview(log, '24h', store, core_api.enforcement_state(store))['attention']]


def test_incidents_group_nearby_failures():
    t = datetime(2026, 11, 20, tzinfo=timezone.utc)
    grouped = incidents([(t, 'bridge', 'OSError'), (t + timedelta(minutes=5), 'bridge', 'OSError'),
                         (t + timedelta(hours=2), 'bridge', 'OSError'), (t + timedelta(minutes=1), 'mcp', 'deadline')])
    assert [(g['component'], g['count']) for g in grouped] == [('bridge', 1), ('bridge', 2), ('mcp', 1)]


def test_granular_history_and_restore_keep_everything(store):
    entry = store.edit(changes={'address': 'keep@example.org', 'note': 'one'})
    store.edit(entry['id'], {'note': 'two', 'expires_at': (NOW + timedelta(days=3)).isoformat()})
    history = [h['change'] for h in store.list()['entries'][0]['edit_history']]
    assert history == ['added', 'note_changed', 'expiry_changed']
    store.edit(entry['id'], remove=True)
    assert store.list()['entries'] == []
    restored = store.restore(entry['id'])
    assert restored['note'] == 'two' and restored['id'] == entry['id']
    assert [h['change'] for h in restored['edit_history']] == ['added', 'note_changed', 'expiry_changed', 'removed', 'added']
    # Every recorded change is readable by the previous release's validator.
    check_history(store.list()['history'])
    with pytest.raises(KeyError):
        store.restore(entry['id'])


@pytest.fixture
def api(store, log, tmp_path, monkeypatch):
    directory = tmp_path / 'api'
    directory.mkdir(mode=0o750)
    monkeypatch.setenv('PROTON_ACTION_LOG', str(tmp_path / 'actions' / 'actions.jsonl'))
    (tmp_path / 'actions').mkdir(mode=0o700)

    class Verifier:
        def authorized(self, tokens):
            return tokens == ['synthetic-valid-assertion']
    server = start_api(str(directory / 'api.sock'), threading.Lock(), lambda *a: {}, store, log, Verifier())

    def call(method, path, body=None):
        conn = UnixConnection(directory / 'api.sock')
        conn.request(method, path, json.dumps(body) if body is not None else None,
                     {'Cf-Access-Jwt-Assertion': 'synthetic-valid-assertion', 'Content-Type': 'application/json'})
        response = conn.getresponse()
        value = response.status, json.loads(response.read())
        conn.close()
        return value
    yield call
    server.shutdown()
    server.server_close()


def test_call_detail_covers_reads_and_writes(api, log):
    rows = log.rows()
    read = next(r for r in rows if r['tool'] == 'read_messages')
    status, value = api('GET', '/api/activity/' + read['id'])
    assert status == 200 and value['call']['counts']['refused']['sender_not_verified'] == 1 and value['action'] is None
    archive = next(r for r in rows if r['tool'] == 'archive_messages')
    status, value = api('GET', '/api/activity/' + archive['id'])
    assert value['action']['unarchive']['eligible'] and value['action']['call_id'] == archive['id']
    assert api('GET', '/api/activity/' + 'f' * 32)[0] == 404
    text = json.dumps(api('GET', '/api/activity')[1])
    assert 'INBOX' not in text and '"folder"' not in text


def test_health_reports_ranges_timelines_enforcement_and_version(api, log, tmp_path, monkeypatch):
    log.health_store.append({'time': (NOW - timedelta(hours=2)).isoformat(), 'connected': False, 'login_ms': 3, 'error_class': 'OSError', 'checks': {'action_log': True, 'allowlist': True}})
    log.health_store.append({'time': (NOW - timedelta(minutes=1)).isoformat(), 'connected': True, 'login_ms': 40, 'error_class': None, 'checks': {'action_log': True, 'allowlist': True}})
    audit_dir = tmp_path / 'audit'
    auth_audit.save({k: 1 for k in core_api.AUDIT_FIELDS}, audit_dir / 'result.json')
    monkeypatch.setenv('MAIL_AUTH_AUDIT_RESULT', str(audit_dir / 'result.json'))
    monkeypatch.setenv('MAIL_TRUSTED_AUTHSERV_ID', 'receiver.example.org')
    for range_name, points in (('24h', 24), ('7d', 28), ('30d', 30)):
        status, value = api('GET', f'/api/health?range={range_name}&tz=America/New_York')
        assert status == 200 and value['range'] == range_name
        assert all(len(c['timeline']) in (points, points + 1) for c in value['components'])
        if range_name == '24h':
            bridge = value['components'][0]['timeline']
            states = [p['state'] for p in bridge if p['state'] != 'unknown']
            assert 'down' in states and states[-1] == 'ok'
    assert value['components'][0]['timeline'][-1]['state'] == 'degraded'
    assert {(i['component'], i['error_class']) for i in value['incidents']} == {('bridge', 'OSError'), ('mcp', 'deadline')}
    assert value['enforcement']['authserv_configured'] and value['enforcement']['store_ok']
    assert value['enforcement']['audit']['counts']['scanned'] == 1
    version = tomllib.loads((Path(__file__).parents[1] / 'pyproject.toml').read_text())['project']['version']
    assert value['about'] == {'version': version, 'release': None}
    assert api('GET', '/api/health?range=1y')[0] == 400


def test_audit_result_is_counts_only_and_private(tmp_path, monkeypatch):
    target = tmp_path / 'audit' / 'result.json'
    auth_audit.save({k: 2 for k in core_api.AUDIT_FIELDS}, target)
    assert os.stat(target).st_mode & 0o777 == 0o600 and os.stat(target.parent).st_mode & 0o777 == 0o700
    assert set(json.loads(target.read_text())) == {'time', 'counts'}
    monkeypatch.setenv('MAIL_AUTH_AUDIT_RESULT', str(target))
    assert core_api.audit_summary()['counts']['scanned'] == 2
    target.chmod(0o644)
    assert core_api.audit_summary() is None


def test_restore_endpoint_and_duplicate_conflicts(api, store):
    status, value = api('POST', '/api/allowlist', {'address': 'undo@example.org', 'note': '', 'expires_at': None})
    ident = value['entry']['id']
    assert status == 201 and 'edit_history' not in value['entry']
    assert api('POST', '/api/allowlist', {'address': 'undo@example.org', 'note': '', 'expires_at': None})[0] == 409
    assert api('DELETE', '/api/allowlist/' + ident)[0] == 200
    assert api('GET', '/api/allowlist/' + ident)[0] == 404
    status, value = api('POST', f'/api/allowlist/{ident}/restore')
    assert status == 200 and value['entry']['address'] == 'undo@example.org' and len(value['entry']['matches']) == 366
    assert 'removed' not in api('GET', '/api/allowlist')[1]
    assert api('POST', f'/api/allowlist/{ident}/restore')[0] == 404


def test_overview_endpoint_accepts_zone(api):
    status, value = api('GET', '/api/overview?range=30d&tz=America/New_York')
    assert status == 200 and len(value['calls']) in (30, 31)
    assert datetime.fromisoformat(value['calls'][-1]['start']).astimezone(ZoneInfo('America/New_York')).hour == 0
    assert parse_qs('') == {}
