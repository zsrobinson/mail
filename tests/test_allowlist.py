"""Policy and API tests use synthetic identities only; never a live mail store."""
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import http.client
import json
import os
from pathlib import Path
import socket
import threading
import pytest
import sys
sys.path.insert(0, str(Path(__file__).parents[1]))
from allowlist import Allowlist
from activity import Activity
from core_api import start_api


@pytest.fixture
def policy(tmp_path):
    directory = tmp_path / 'policy'
    directory.mkdir(mode=0o700)
    path = directory / 'allowlist.json'
    path.write_text(json.dumps({'version': 1, 'entries': [], 'history': []}))
    path.chmod(0o600)
    store = Allowlist(path)
    store.edit(changes={'address': 'updates@example.org'})
    return store


def raw(origin='updates@example.org', auth='receiver.example.org; dmarc=pass header.from=example.org', extra=None):
    message = EmailMessage()
    if origin is not None:
        message['From'] = origin
    if auth is not None:
        message['Authentication-Results'] = auth
    if extra:
        message['Authentication-Results'] = extra
    message.set_content('Synthetic private body')
    return message.as_bytes()


@pytest.mark.parametrize('origin,auth,expected', [
    ('updates@example.org', 'receiver.example.org; dmarc=pass header.from=example.org', None),
    ('UPDATES@EXAMPLE.ORG', 'receiver.example.org; dkim=pass header.d=example.org', None),
    ('Other display <updates@example.org>', 'receiver.example.org; dkim=pass header.d=example.org', None),
    ('updates@example.org <attacker@example.net>', 'receiver.example.org; dmarc=pass header.from=example.net', 'sender_not_allowlisted'),
    ('updates@example.org, attacker@example.net', None, 'sender_not_allowlisted'),
    (None, None, 'sender_not_allowlisted'),
    ('updаtes@example.org', None, 'sender_not_allowlisted'),
    ('updates@exаmple.org', None, 'sender_not_allowlisted'),
    ('updates@example.org', None, 'sender_not_verified'),
    ('updates@example.org', 'upstream.example.net; dmarc=pass header.from=example.org', 'sender_not_verified'),
    ('updates@example.org', 'receiver.example.org; dmarc=fail header.from=example.org', 'sender_not_verified'),
    ('updates@example.org', 'receiver.example.org; dkim=pass header.d=example.org.attacker.net', 'sender_not_verified'),
    ('updates@example.org', 'receiver.example.org; dkim=pass header.d=example.net', 'sender_not_verified'),
    ('updates@example.org', 'receiver.example.org; dmarc=pass header.from=example.org header.from=evil.org', 'sender_not_verified'),
    ('updates@example.org', 'receiver.example.org; dkim=fail (dkim=pass header.d=example.org)', 'sender_not_verified'),
])
def test_sender_auth(policy, origin, auth, expected):
    assert policy.decision(raw(origin, auth), 'receiver.example.org') == expected


def test_trust_boundary_and_expiry(policy):
    assert policy.decision(raw(extra='receiver.example.org; dmarc=fail header.from=example.org'), '') == 'sender_not_verified'
    assert policy.decision(raw(auth='attacker.example.net; dmarc=pass header.from=example.org', extra='receiver.example.org; dmarc=pass header.from=example.org'), 'receiver.example.org') == 'sender_not_verified'
    item = policy.list()['entries'][0]
    policy.edit(item['id'], {'expires_at': (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()})
    assert policy.decision(raw(), 'receiver.example.org') == 'sender_not_allowlisted'
    policy.edit(item['id'], {'expires_at': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()})
    assert policy.decision(raw(), 'receiver.example.org') is None


@pytest.mark.parametrize('corruption', ['missing', 'json', 'wide_file', 'wide_dir', 'symlink', 'hardlink', 'invalid_entry'])
def test_fail_closed_hot_reload(policy, corruption, tmp_path):
    assert policy.decision(raw(), 'receiver.example.org') is None
    if corruption == 'missing':
        policy.path.unlink()
    elif corruption == 'json':
        policy.path.write_text('{')
    elif corruption == 'wide_file':
        policy.path.chmod(0o640)
    elif corruption == 'wide_dir':
        policy.path.parent.chmod(0o750)
    elif corruption == 'symlink':
        saved = tmp_path / 'saved.json'
        policy.path.rename(saved)
        policy.path.symlink_to(saved)
    elif corruption == 'hardlink':
        os.link(policy.path, tmp_path / 'other.json')
    else:
        policy.path.write_text('{"version":1,"entries":[{}],"history":[]}')
    assert policy.decision(raw(), 'receiver.example.org') == 'sender_not_allowlisted'


def test_multiple_from_headers(policy):
    message = raw().replace(b'From: updates@example.org\n', b'From: updates@example.org\nFrom: attacker@example.net\n')
    assert policy.decision(message, 'receiver.example.org') == 'sender_not_allowlisted'


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=2)
        self.path = str(path)
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.connect(self.path)


@pytest.fixture
def api(policy, tmp_path):
    directory = tmp_path / 'api'
    directory.mkdir(mode=0o750)
    class Verifier:
        def authorized(self, tokens):
            return tokens == ['synthetic-valid-assertion']
    activity = Activity(tmp_path / 'activity' / 'activity.jsonl')
    def call(*args):
        return {'action_id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'changes': [{}, {}], 'completed': ['1', '2']}
    server = start_api(str(directory / 'api.sock'), threading.Lock(), call, policy, activity, Verifier())
    yield directory / 'api.sock', activity
    server.shutdown()
    server.server_close()


@pytest.mark.parametrize('token', [None, 'expired', 'wrong-audience', 'synthetic-valid-assertion'])
@pytest.mark.parametrize('method,path,body', [('POST','/api/allowlist',{'address':'new@example.org'}), ('PATCH','/api/allowlist/none', {'note':'test'}), ('DELETE','/api/allowlist/none', {})])
def test_mutations_reverify(api, token, method, path, body):
    conn = UnixConnection(api[0])
    headers = {'Content-Type':'application/json'}
    if token:
        headers['Cf-Access-Jwt-Assertion'] = token
    conn.request(method, path, json.dumps(body), headers)
    response = conn.getresponse()
    assert response.status == (201 if method == 'POST' else 404) if token == 'synthetic-valid-assertion' else response.status == 401
    conn.close()


def test_activity_never_copies_mail(api):
    _, log = api
    log.record({'tool': 'read_messages', 'ts': datetime.now(timezone.utc).isoformat(), 'requested': 2, 'outcome':'ok', 'total_ms': 1, 'error_class':None, 'phase':{'login':2}},
               {'messages':[{'body':'SECRET BODY', 'headers':{'From':'secret@example.net'}}, {'refusal':{'code':'sender_not_verified'}}]}, {'folder':'SECRET FOLDER', 'uids':['98765']})
    content = log.path.read_text()
    for private in ('SECRET', 'secret@example.net', '98765', 'folder', 'headers', 'body'):
        assert private not in content
    row = log.rows()[0]
    assert row['outcome'] == 'refused'
    assert row['counts']['returned'] == 1
    assert row['counts']['refused']['sender_not_verified'] == 1
    assert 'mail_read_refusals_total' in log.metrics()


def test_unarchive_requires_preview_token_and_consumes_it(api):
    path, log = api
    ident = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    log.record({'tool': 'archive_messages', 'ts':datetime.now(timezone.utc).isoformat(),'requested':2,'outcome':'ok','error_class':None,'total_ms':1,'phase':{'login':1}}, {'action_id':ident,'completed':['1','2']}, {})
    headers = {'Content-Type':'application/json','Cf-Access-Jwt-Assertion':'synthetic-valid-assertion'}
    def post(body):
        conn = UnixConnection(path)
        conn.request('POST', '/api/actions/'+ident+'/unarchive', json.dumps(body), headers)
        response = conn.getresponse()
        result = response.status,json.loads(response.read())
        conn.close()
        return result
    assert post({'dry_run':False})[0] == 409
    status, value = post({'dry_run':True})
    assert status == 200 and value['messages'] == 2
    assert post({'dry_run':False,'preview_token':value['preview_token']})[0] == 200
    assert post({'dry_run':False,'preview_token':value['preview_token']})[0] == 409


def test_aggregate_auth_audit_reads_only_synthetic_headers(policy):
    from auth_audit import audit
    class Fake:
        def select(self, folder, readonly):
            assert readonly
            return 'OK', []
        def uid(self, operation, *args):
            if operation == 'SEARCH':
                return 'OK', [b'1 2']
            assert operation == 'FETCH' and 'HEADER.FIELDS' in args[1] and 'BODY.PEEK[]' not in args[1]
            value = raw(auth=None) if args[0] == '2' else raw()
            return 'OK', [(b'1 (UID 1)', value)]
    result = audit(Fake(), policy, 'receiver.example.org')
    assert result['allowlisted_sender'] == 4
    assert result['authenticated_allowlisted'] == 2
    assert result['unverified_allowlisted'] == 2
    assert all(type(count) is int for count in result.values())


def test_authserv_optional_version_and_upstream_headers(policy):
    assert policy.decision(raw(auth='receiver.example.org 1 (trusted receiver); dmarc=pass (p=none) header.from=example.org', extra='attacker.example.net; dmarc=fail header.from=example.org'), 'receiver.example.org') is None
    assert policy.decision(raw(auth='receiver.example.org.attacker.net; dkim=pass header.d=example.org'), 'receiver.example.org') == 'sender_not_verified'


def test_match_counter_and_edit_history_contain_only_metadata(policy):
    item = policy.list()['entries'][0]
    assert policy.decision(raw(), 'receiver.example.org') is None
    updated = policy.list()['entries'][0]
    assert updated['match_count'] == 1 and updated['matches'][-1]['count'] == 1
    policy.edit(item['id'], {'note':'Synthetic note'})
    assert all(set(row) == {'time','change'} for row in policy.list()['history'])
