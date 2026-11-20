"""Private Unix-socket JSON API. Policy edits never appear in the MCP tools."""
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import socketserver
import stat
import threading
import time
from urllib.parse import urlsplit, parse_qs
from access import AccessJWT
from action_log import PublicError


class UnixHTTP(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    block_on_close = False

    def handle_error(self, request, client_address):
        pass  # Never emit request data or exception details.


WRITE_KINDS = {'archive_messages': 'archive', 'unarchive_messages': 'unarchive', 'move_messages': 'move', 'add_labels': 'label', 'mark_read': 'mark_read', 'create_draft': 'draft'}


def bridge_summary(health):
    component = health['components'][0]
    return {k: component[k] for k in ('state', 'latency_ms', 'last_success_at', 'latency')} | {'checked_at': health['checked_at']}


def overview(activity, range_name):
    days = {'24h': 1, '7d': 7, '30d': 30}[range_name]
    seconds = {'24h': 3600, '7d': 21600, '30d': 86400}[range_name]
    rows = activity.rows(days)
    end = int(time.time()) // seconds * seconds
    count = days * 86400 // seconds
    buckets = {end - offset * seconds: {'ok': 0, 'error': 0, 'allowed': 0, 'refused': 0} for offset in reversed(range(count))}
    for row in rows:
        key = int(datetime.fromisoformat(row['time']).timestamp()) // seconds * seconds
        if key not in buckets:
            continue
        bucket = buckets[key]
        bucket['ok' if row['outcome'] == 'ok' else 'error'] += 1
        if row['tool'] == 'read_messages':
            bucket['allowed'] += row['counts']['returned']
            bucket['refused'] += sum(row['counts']['refused'].values())
    def start(key):
        return datetime.fromtimestamp(key, timezone.utc).isoformat()
    writes = []
    for tool, kind in WRITE_KINDS.items():
        changes = [r for r in rows if r['tool'] == tool and not r.get('dry_run')]
        writes.append({'kind': kind, 'calls': len(changes), 'messages': sum(sum(r['counts'][k] for k in ('moved', 'labelled', 'marked', 'drafts')) for r in changes)})
    return dict(range=range_name, generated_at=datetime.now(timezone.utc).isoformat(), bucket_seconds=seconds,
                totals=dict(calls=sum(b['ok'] + b['error'] for b in buckets.values()), errors=sum(b['error'] for b in buckets.values()),
                            body_reads_allowed=sum(b['allowed'] for b in buckets.values()), body_reads_refused=sum(b['refused'] for b in buckets.values()),
                            writes=sum(w['calls'] for w in writes)),
                calls=[dict(start=start(k), ok=b['ok'], error=b['error']) for k, b in buckets.items()],
                body_reads=[dict(start=start(k), allowed=b['allowed'], refused=b['refused']) for k, b in buckets.items()],
                writes_by_kind=writes, bridge=bridge_summary(activity.health(rows)))


def action_detail(ident, rows, all_rows):
    row = rows[-1]
    completed = sum(row['counts'][k] for k in ('moved', 'labelled', 'marked', 'drafts'))
    requested = row['counts']['requested']
    chunks = row.get('chunks', [])
    uncertain = sum(c['size'] for c in chunks if c['status'] == 'uncertain')
    if row['tool'] == 'create_draft' and row['outcome'] != 'ok':
        uncertain = requested
    status = 'dry_run' if row.get('dry_run') else 'completed' if row['outcome'] == 'ok' else 'uncertain' if uncertain else 'partial' if completed else 'failed'
    restored = next((r['action_id'] for r in all_rows if r.get('source_action_id') == ident and not r.get('dry_run') and r['outcome'] == 'ok'), None)
    value = dict(id=ident, tool=row['tool'], kind=WRITE_KINDS.get(row['tool']), time=row['time'],
                 dry_run=bool(row.get('dry_run')), status=status,
                 counts=dict(requested=requested, completed=completed, uncertain=uncertain, failed=max(0, requested - completed - uncertain) if status != 'dry_run' else 0),
                 chunks=chunks)
    if row['tool'] == 'archive_messages':
        eligible = status == 'completed' and not restored
        value['unarchive'] = dict(eligible=eligible, reason=None if eligible else 'This action is a preview, incomplete, or already restored.', restored_by=restored)
    return value


def policy_payload(policy):
    data = policy.list()
    today = datetime.now(timezone.utc).date()
    for entry in data['entries']:
        matches = {p['date']: p['count'] for p in entry.get('matches', [])}
        entry['matches'] = [{'date': (today - timedelta(days=offset)).isoformat(),
                             'count': matches.get((today - timedelta(days=offset)).isoformat(), 0)}
                            for offset in reversed(range(366))]
    data['history'] = list(reversed(data['history'][-50:]))
    return data


def core_health(server):
    data = server.activity.health()
    current = datetime.now(timezone.utc).isoformat()
    def component(ident, name, good):
        return dict(id=ident, name=name, state='ok' if good else 'down', latency_ms=None,
                    p50_ms=None, p95_ms=None, latency=[], errors_24h=0 if good else 1,
                    failures=[] if good else [{'error_class': 'unavailable', 'count': 1}],
                    last_success_at=current if good else None, last_error_at=None if good else current,
                    error_class=None if good else 'unavailable')
    try:
        server.policy.list()
        policy_ok = True
    except Exception:
        policy_ok = False
    path = Path(os.environ.get('PROTON_ACTION_LOG', '/var/lib/proton-mail/actions/actions.jsonl'))
    try:
        info = path.parent.lstat()
        journal_ok = stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077
        if path.exists() or path.is_symlink():
            info = path.lstat()
            journal_ok = journal_ok and stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077 and info.st_nlink == 1
    except OSError:
        journal_ok = False
    listener_ok = server.listener_healthy() if server.listener_healthy else True
    data['components'] += [component('mcp', 'MCP listener', listener_ok),
                           component('action_log', 'Action log', journal_ok),
                           component('allowlist', 'Allowlist store', policy_ok)]
    if not (listener_ok and journal_ok and policy_ok):
        data['state'] = 'down'
    data['checked_at'] = current
    return data


class APIHandler(http.server.BaseHTTPRequestHandler):
    server_version = 'MailPrivate/1'

    def log_message(self, *_):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def reply(self, status, value=None, content_type='application/json'):
        raw = value.encode() if content_type != 'application/json' else json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def handle_request(self):
        try:
            self.dispatch()
        except KeyError:
            self.reply(404, {'error': 'Not found'})
        except (ValueError, TypeError, UnicodeError):
            self.reply(400, {'error': 'Invalid request'})
        except PublicError:
            self.reply(409, {'error': 'Operation refused; check activity before retrying'})
        except Exception:
            self.reply(503, {'error': 'Core state unavailable'})

    def dispatch(self):
        parsed = urlsplit(self.path)
        parts = parsed.path.strip('/').split('/')
        query = parse_qs(parsed.query)
        mutation = self.command != 'GET'
        # All mutations re-verify the forwarded web application's audience.
        tokens = self.headers.get_all('Cf-Access-Jwt-Assertion', [])
        if parsed.path.startswith('/api/') and (self.server.access is None or not self.server.access.authorized(tokens)):
            # Consume only a bounded, unambiguous body before closing HTTP/1.0.
            # Otherwise a client writing headers/body separately can race a 401
            # and receive a broken pipe instead of the authentication response.
            lengths = self.headers.get_all('Content-Length', [])
            if len(lengths) == 1 and lengths[0].isdigit() and not self.headers.get('Transfer-Encoding') and not self.headers.get('Expect'):
                length = int(lengths[0])
                if 0 < length <= 16384:
                    self.rfile.read(length)
            return self.reply(401, {'error': 'Invalid or missing Access assertion'})
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) > 1:
            return self.reply(400, {'error': 'Invalid framing'})
        body = {}
        if mutation:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 <= length <= 16384:
                return self.reply(413, {'error': 'Request too large'})
            if length:
                if self.headers.get_content_type() != 'application/json':
                    return self.reply(415, {'error': 'JSON required'})
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError()
        if parsed.path == '/metrics' and not mutation:
            return self.reply(200, self.server.activity.metrics(), 'text/plain; version=0.0.4')
        if parts[:2] == ['api', 'allowlist']:
            policy = self.server.policy
            if len(parts) == 2 and self.command == 'GET':
                data = policy_payload(policy)
                for entry in data['entries']:
                    entry.pop('edit_history', None)
                return self.reply(200, data)
            if len(parts) == 2 and self.command == 'POST':
                return self.reply(201, {'entry': policy.edit(changes=body)})
            if len(parts) == 3:
                ident = parts[2]
                if self.command == 'GET':
                    data = policy_payload(policy)
                    entry = next((e for e in data['entries'] if e['id'] == ident), None)
                    if entry is None:
                        raise KeyError()
                    return self.reply(200, {'entry': {k: v for k, v in entry.items() if k != 'edit_history'}, 'history': list(reversed(entry.get('edit_history', [])[-50:]))})
                if self.command in ('PATCH', 'DELETE'):
                    if self.command == 'DELETE' and body:
                        raise ValueError()
                    entry = policy.edit(ident, body, self.command == 'DELETE')
                    return self.reply(200, {} if self.command == 'DELETE' else {'entry': entry})
        if self.command == 'GET' and parsed.path == '/api/overview':
            range_name = query.get('range', ['7d'])[0]
            if range_name not in ('24h', '7d', '30d'):
                raise ValueError()
            return self.reply(200, overview(self.server.activity, range_name))
        if self.command == 'GET' and parsed.path == '/api/health':
            return self.reply(200, core_health(self.server))
        if self.command == 'GET' and parsed.path == '/api/activity':
            rows = [r for r in self.server.activity.rows() if (not query.get('tool') or r['tool'] == query['tool'][0]) and (not query.get('outcome') or r['outcome'] == query['outcome'][0])]
            return self.reply(200, {'rows': list(reversed(rows[-200:])), 'truncated': len(rows) > 200})
        if len(parts) >= 3 and parts[:2] == ['api', 'actions'] and re.fullmatch(r'[a-f0-9-]{36}', parts[2]):
            ident = parts[2]
            rows = [r for r in self.server.activity.rows() if r.get('action_id') == ident]
            if not rows:
                raise KeyError()
            if len(parts) == 3 and self.command == 'GET':
                return self.reply(200, action_detail(ident, rows, self.server.activity.rows()))
            if len(parts) == 4 and parts[3] == 'unarchive' and self.command == 'POST':
                if set(body) - {'dry_run', 'preview_token'} or type(body.get('dry_run')) is not bool:
                    raise ValueError()
                detail = action_detail(ident, rows, self.server.activity.rows())
                if not detail.get('unarchive', {}).get('eligible'):
                    return self.reply(409, {'error': 'This archive action cannot be restored'})
                if not self.server.mail_slot.acquire(blocking=False):
                    return self.reply(409, {'error': 'Mail service busy'})
                try:
                    current = self.server.activity.rows()
                    current_rows = [r for r in current if r.get('action_id') == ident]
                    if not current_rows or not action_detail(ident, current_rows, current).get('unarchive', {}).get('eligible'):
                        return self.reply(409, {'error': 'This archive action cannot be restored'})
                    assertion = hashlib.sha256(tokens[0].encode()).hexdigest()
                    if not body['dry_run']:
                        with self.server.preview_lock:
                            preview = self.server.previews.pop(body.get('preview_token', ''), None)
                        if not preview or preview[:2] != (ident, assertion) or preview[2] < time.monotonic():
                            return self.reply(409, {'error': 'Preview this action first'})
                    result = self.server.call('unarchive_messages', {'action_id': ident, 'dry_run': body['dry_run']})
                    # No UIDs, subjects, senders or target names cross this API.
                    value = dict(action_id=result.get('action_id'), dry_run=body['dry_run'],
                                 count=len(result.get('changes', [])) if body['dry_run'] else len(result.get('completed', [])),
                                 uncertain=bool(result.get('uncertain')), stopped=bool(result.get('stopped')))
                    if body['dry_run'] and not value['uncertain'] and not value['stopped']:
                        token = secrets.token_urlsafe(32)
                        with self.server.preview_lock:
                            self.server.previews = {k: v for k, v in self.server.previews.items() if v[2] >= time.monotonic()}
                            self.server.previews[token] = (ident, assertion, time.monotonic() + 120)
                        value.update(preview_token=token, expires_at=(datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat(), messages=value['count'], chunks=len(result.get('completed_chunks', [])) or 1)
                    if not body['dry_run']:
                        value.update(status='uncertain' if value['uncertain'] else 'partial' if value['stopped'] else 'completed', counts=dict(requested=rows[-1]['counts']['requested'], completed=value['count'], uncertain=0, failed=0))
                    return self.reply(200, value)
                finally:
                    self.server.mail_slot.release()
        self.reply(404, {'error': 'Not found'})

    do_GET = do_POST = do_PATCH = do_DELETE = handle_request


def start_api(filename, slot, call, policy, activity, verifier=None, listener_healthy=None):
    path = Path(filename)
    directory = path.parent.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.getuid() or directory.st_mode & 0o007 or directory.st_mode & 0o020:
        raise ValueError('API socket directory must be service-owned and group-traversable only')
    if path.exists() or path.is_symlink():
        st = path.lstat()
        if not stat.S_ISSOCK(st.st_mode) or st.st_uid != os.getuid():
            raise ValueError('Refusing to replace socket path')
        path.unlink()
    if verifier is None:
        team, audience = os.environ.get('ACCESS_TEAM_DOMAIN', ''), os.environ.get('MAIL_WEB_ACCESS_AUD', '')
        if not team or not audience:
            raise ValueError('Web Access verification must be configured')
        verifier = AccessJWT(team, audience)
    server = UnixHTTP(filename, APIHandler)
    os.chmod(filename, 0o660)
    # Directory has a setgid shared group; the socket inherits that group.
    server.listener_healthy = listener_healthy
    server.access, server.mail_slot, server.call = verifier, slot, call
    server.policy, server.activity = policy, activity
    server.previews, server.preview_lock = {}, threading.Lock()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def start_metrics(activity, port):
    """Loopback aggregate-only listener; never mounts the private JSON API."""
    class MetricsHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_GET(self):
            if self.path != '/metrics':
                self.send_error(404)
                return
            raw = activity.metrics().encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; version=0.0.4')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        def setup(self):
            super().setup()
            self.connection.settimeout(10)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', int(port)), MetricsHandler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
