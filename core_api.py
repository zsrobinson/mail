"""Private Unix-socket JSON API. Policy edits never appear in the MCP tools."""
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import http.server
import json
import math
import os
from pathlib import Path
import re
import secrets
import socketserver
import stat
import threading
import time
from urllib.parse import urlsplit, parse_qs
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from access import AccessJWT
from action_log import PublicError


class UnixHTTP(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    block_on_close = False

    def handle_error(self, request, client_address):
        pass  # Never emit request data or exception details.


WRITE_KINDS = {'archive_messages': 'archive', 'unarchive_messages': 'unarchive', 'move_messages': 'move', 'add_labels': 'label', 'mark_read': 'mark_read', 'create_draft': 'draft'}
RANGES = {'24h': (1, 'hour'), '7d': (7, '6h'), '30d': (30, 'day')}
# Overview charts use whole days beyond 24 hours so labels land on dates.
OVERVIEW_UNITS = {'24h': 'hour', '7d': 'day', '30d': 'day'}
# The installer records the pinned release here; the core never guesses one.
RELEASE_FILE = Path(__file__).with_name('release.json')
OUTCOMES = ('ok', 'refused', 'error', 'busy')
UUID = r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'
CALL_ID = r'[a-f0-9]{32}'
PAGE_MAX = 200
# Words a person might search for. Only fixed vocabulary: never mail content.
SEARCH_WORDS = {
    'list_folders': 'list folders', 'list_messages': 'list messages', 'search_messages': 'search messages',
    'list_unsubscribe': 'unsubscribe headers', 'read_messages': 'read bodies body reads', 'create_draft': 'create draft',
    'archive_messages': 'archive', 'unarchive_messages': 'unarchive restore', 'move_messages': 'move',
    'add_labels': 'add labels label', 'mark_read': 'mark read', 'list_actions': 'action history',
    'sender_not_allowlisted': 'not on allowlist not allowlisted refused', 'sender_not_verified': 'sender not verified unverified refused',
    'deadline': 'deadline timed out timeout', 'stopped': 'stopped partial', 'PublicError': 'refused rejected',
    'TimeoutError': 'timeout timed out', 'OSError': 'connection network', 'busy': 'busy',
}
# How long a quiet gap must be before two failures count as separate incidents.
INCIDENT_GAP = timedelta(minutes=15)
SPIKE_MIN = 5
EXPIRY_NOTICE = timedelta(days=7)


def zone(name):
    """The caller's IANA time zone for calendar buckets; UTC when unknown."""
    if isinstance(name, str) and len(name) <= 64 and re.fullmatch(r'[A-Za-z0-9_+-]+(?:/[A-Za-z0-9_+-]+){0,2}', name):
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            pass
    return timezone.utc


def floor_time(moment, unit, tz):
    local = moment.astimezone(tz)
    if unit == 'hour':
        local = local.replace(minute=0, second=0, microsecond=0)
    elif unit == '6h':
        local = local.replace(hour=local.hour - local.hour % 6, minute=0, second=0, microsecond=0)
    else:
        day = local.date() - timedelta(days=local.weekday() if unit == 'week' else 0)
        local = datetime(day.year, day.month, day.day, tzinfo=tz)
    return local.astimezone(timezone.utc)


def step_time(start, unit, tz):
    if unit in ('hour', '6h'):
        return floor_time(start + timedelta(hours=1 if unit == 'hour' else 6, minutes=30), unit, tz)
    local = start.astimezone(tz)
    day = local.date() + timedelta(days=7 if unit == 'week' else 1)
    return datetime(day.year, day.month, day.day, tzinfo=tz).astimezone(timezone.utc)


def buckets(first, last, unit, tz):
    """Calendar buckets in the caller's zone, covering first..last inclusive."""
    starts, current = [], floor_time(first, unit, tz)
    while current <= last and len(starts) < 1000:
        starts.append(current)
        current = step_time(current, unit, tz)
    return starts


def bucket_seconds(unit):
    return {'hour': 3600, '6h': 21600, 'day': 86400, 'week': 604800}[unit]


def parse_time(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Timezone required')
    return parsed.astimezone(timezone.utc)


def range_window(range_name, tz, now=None, unit=None):
    days, default = RANGES[range_name]
    unit = unit or default
    now = now or datetime.now(timezone.utc)
    starts = buckets(now - timedelta(days=days), now, unit, tz)
    starts = starts[-(days * 86400 // bucket_seconds(unit)):]
    return starts, unit


def refused(row):
    return sum(row['counts']['refused'].values())


def changed(row):
    return sum(row['counts'][k] for k in ('moved', 'labelled', 'marked', 'drafts'))


def bridge_summary(health):
    component = health['components'][0]
    return {k: component[k] for k in ('state', 'latency_ms', 'last_success_at', 'latency')} | {'checked_at': health['checked_at']}


def period_totals(rows):
    reads = [r for r in rows if r['tool'] == 'read_messages']
    return dict(calls=len(rows), errors=sum(r['outcome'] != 'ok' for r in rows),
                refused_calls=sum(r['outcome'] == 'refused' for r in rows),
                failed=sum(r['outcome'] in ('error', 'busy') for r in rows),
                body_reads_allowed=sum(r['counts']['returned'] for r in reads),
                body_reads_refused=sum(refused(r) for r in reads),
                writes=sum(r['tool'] in WRITE_KINDS and not r.get('dry_run') for r in rows),
                messages_changed=sum(changed(r) for r in rows if r['tool'] in WRITE_KINDS and not r.get('dry_run')),
                refusals={'sender_not_allowlisted': sum(r['counts']['refused']['sender_not_allowlisted'] for r in reads),
                          'sender_not_verified': sum(r['counts']['refused']['sender_not_verified'] for r in reads)})


def entry_state(entry, now):
    if not entry.get('expires_at'):
        return 'active'
    expires = parse_time(entry['expires_at'])
    return 'expired' if expires <= now else 'expiring' if expires - now <= EXPIRY_NOTICE else 'active'


def attention(policy, totals, previous, bridge, enforcement, now):
    """Things worth a look, most urgent first. Empty when all is well."""
    items = []
    if not enforcement['store_ok']:
        items.append(dict(kind='allowlist_unavailable', severity='critical'))
    if not enforcement['authserv_configured']:
        items.append(dict(kind='authserv_missing', severity='critical'))
    audit = enforcement.get('audit')
    if audit and audit['counts']['allowlisted_sender'] > 0 and audit['counts']['authenticated_allowlisted'] == 0:
        items.append(dict(kind='audit_refuses_all', severity='critical', time=audit['time']))
    if bridge['state'] in ('down', 'degraded'):
        items.append(dict(kind='bridge', severity='critical' if bridge['state'] == 'down' else 'warning', state=bridge['state'], time=bridge.get('last_success_at')))
    current, before = sum(totals['refusals'].values()), sum(previous['refusals'].values())
    if current >= SPIKE_MIN and current >= 2 * max(1, before):
        items.append(dict(kind='refusal_spike', severity='warning', count=current, previous=before))
    if enforcement['store_ok']:
        for entry in sorted(policy.list()['entries'], key=lambda e: e.get('expires_at') or ''):
            state = entry_state(entry, now)
            expires = parse_time(entry['expires_at']) if entry.get('expires_at') else None
            if state == 'expiring' or (state == 'expired' and now - expires <= EXPIRY_NOTICE):
                items.append(dict(kind='expiring' if state == 'expiring' else 'expired', severity='warning' if state == 'expiring' else 'info',
                                  entry_id=entry['id'], address=entry['address'], time=entry['expires_at']))
    return items


def overview(activity, range_name, policy=None, enforcement=None, tz=timezone.utc):
    now = datetime.now(timezone.utc)
    starts, unit = range_window(range_name, tz, now, OVERVIEW_UNITS[range_name])
    first = starts[0]
    length = now - first
    rows = [r | {'_at': parse_time(r['time'])} for r in activity.rows(RANGES[range_name][0] * 2 + 2)]
    current = [r for r in rows if r['_at'] >= first]
    previous = [r for r in rows if first - length <= r['_at'] < first]
    keys = {s: {'ok': 0, 'refused_calls': 0, 'error': 0, 'allowed': 0, 'refused': 0} for s in starts}
    for row in current:
        bucket = keys.get(floor_time(row['_at'], unit, tz))
        if bucket is None:
            continue
        bucket['ok' if row['outcome'] == 'ok' else 'refused_calls' if row['outcome'] == 'refused' else 'error'] += 1
        if row['tool'] == 'read_messages':
            bucket['allowed'] += row['counts']['returned']
            bucket['refused'] += refused(row)
    writes = []
    for tool, kind in WRITE_KINDS.items():
        done = [r for r in current if r['tool'] == tool and not r.get('dry_run')]
        writes.append({'kind': kind, 'calls': len(done), 'messages': sum(changed(r) for r in done)})
    health = activity.health()
    bridge = bridge_summary(health)
    totals, before = period_totals(current), period_totals(previous)
    top = []
    if policy is not None and (enforcement is None or enforcement['store_ok']):
        since = (first.astimezone(tz)).date().isoformat()
        for entry in policy.list()['entries']:
            count = sum(m['count'] for m in entry.get('matches', []) if m['date'] >= since)
            if count:
                top.append(dict(id=entry['id'], address=entry['address'], matches=count, state=entry_state(entry, now)))
        top = sorted(top, key=lambda e: (-e['matches'], e['address']))[:5]
    return dict(range=range_name, generated_at=now.isoformat(), bucket_seconds=bucket_seconds(unit),
                period=dict(start=first.isoformat(), end=now.isoformat(), previous_start=(first - length).isoformat()),
                totals=totals, previous=before,
                calls=[dict(start=k.isoformat(), ok=b['ok'], refused=b['refused_calls'], error=b['error']) for k, b in keys.items()],
                body_reads=[dict(start=k.isoformat(), allowed=b['allowed'], refused=b['refused']) for k, b in keys.items()],
                writes_by_kind=writes, top_senders=top, bridge=bridge,
                attention=attention(policy, totals, before, bridge, enforcement, now) if policy is not None and enforcement is not None else [])


def matches_query(row, words):
    text = ' '.join(filter(None, [row['tool'], SEARCH_WORDS.get(row['tool'], ''), row['outcome'], row.get('error_class') or '',
                                  SEARCH_WORDS.get(row.get('error_class') or '', ''), row.get('action_id') or '',
                                  row.get('source_action_id') or '', row['id']]
                           + [code + ' ' + SEARCH_WORDS[code] for code, count in row['counts']['refused'].items() if count]
                           + (['dry run preview'] if row.get('dry_run') else []))).lower()
    return all(word in text for word in words)


def activity_query(activity, query):
    """Server-side filters, paging and a calls-over-time series for the result."""
    def one(name, default=''):
        values = query.get(name, [default])
        if len(values) != 1:
            raise ValueError()
        return values[0]
    tools = [t for t in one('tool').split(',') if t]
    if len(tools) > 20 or any(not re.fullmatch(r'[a-z_]{1,32}', t) for t in tools):
        raise ValueError()
    outcomes = [o for o in one('outcome').split(',') if o]
    if any(o not in OUTCOMES for o in outcomes):
        raise ValueError()
    words = one('q').lower().split()
    if len(one('q')) > 200:
        raise ValueError()
    start = parse_time(one('from')) if one('from') else None
    end = parse_time(one('to')) if one('to') else None
    only_refusals = one('refusals') in ('1', 'true')
    offset, limit = int(one('offset', '0')), int(one('limit', '50'))
    if not 0 <= offset <= 1_000_000 or not 1 <= limit <= PAGE_MAX:
        raise ValueError()
    tz = zone(one('tz', 'UTC'))
    now = datetime.now(timezone.utc)
    days = 366 if start is None else max(1, math.ceil((now - start).total_seconds() / 86400) + 1)
    rows = []
    for row in activity.rows(min(366, days)):
        at = parse_time(row['time'])
        if (start and at < start) or (end and at >= end) or (tools and row['tool'] not in tools) or (outcomes and row['outcome'] not in outcomes):
            continue
        if only_refusals and not refused(row):
            continue
        if words and not matches_query(row, words):
            continue
        rows.append(row | {'_at': at})
    rows.reverse()
    span_start = start or (rows[-1]['_at'] if rows else now - timedelta(days=7))
    span_end = min(end, now) if end else now
    span = span_end - span_start
    unit = 'hour' if span <= timedelta(days=2) else 'day' if span <= timedelta(days=92) else 'week'
    series = {s: {'ok': 0, 'refused': 0, 'error': 0} for s in buckets(span_start, span_end, unit, tz)}
    for row in rows:
        bucket = series.get(floor_time(row['_at'], unit, tz))
        if bucket is not None:
            bucket['ok' if row['outcome'] == 'ok' else 'refused' if row['outcome'] == 'refused' else 'error'] += 1
    page = [{k: v for k, v in r.items() if k != '_at'} for r in rows[offset:offset + limit]]
    return dict(rows=page, total=len(rows), offset=offset, limit=limit, truncated=offset + len(page) < len(rows),
                series=dict(bucket_seconds=bucket_seconds(unit), points=[dict(start=k.isoformat(), **v) for k, v in series.items()]))


def action_detail(ident, rows, all_rows):
    row = rows[-1]
    completed = changed(row)
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
                 chunks=chunks, call_id=row.get('id'), source_action_id=row.get('source_action_id'))
    if row['tool'] == 'archive_messages':
        eligible = status == 'completed' and not restored
        value['unarchive'] = dict(eligible=eligible, reason=None if eligible else 'This action is a preview, incomplete, or already restored.', restored_by=restored)
    return value


def call_detail(ident, all_rows):
    row = next((r for r in all_rows if r['id'] == ident), None)
    if row is None:
        raise KeyError()
    action = None
    if row.get('action_id'):
        action = action_detail(row['action_id'], [r for r in all_rows if r.get('action_id') == row['action_id']], all_rows)
    return dict(call=row, action=action)


def policy_payload(policy):
    data = policy.list()
    today = datetime.now(timezone.utc).date()
    for entry in data['entries']:
        matches = {p['date']: p['count'] for p in entry.get('matches', [])}
        entry['matches'] = [{'date': (today - timedelta(days=offset)).isoformat(),
                             'count': matches.get((today - timedelta(days=offset)).isoformat(), 0)}
                            for offset in reversed(range(366))]
    data['history'] = list(reversed(data['history'][-50:]))
    data.pop('removed', None)
    return data


def public_entry(entry):
    return {k: v for k, v in entry.items() if k not in ('edit_history', 'removed_at')}


def private_file(path):
    """Read a small JSON file only when it and its directory are owned and private."""
    parent = path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError('Directory must be owned and private')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1 or info.st_size > 65536:
            raise ValueError('File must be owned and private')
        return json.loads(stream.read())


AUDIT_FIELDS = {'scanned', 'allowlisted_sender', 'authenticated_allowlisted', 'unverified_allowlisted', 'with_authentication_results', 'with_trusted_topmost', 'candidates'}


def audit_summary():
    """The last aggregate auth-audit result: a time and counts, nothing else."""
    filename = os.environ.get('MAIL_AUTH_AUDIT_RESULT')
    if not filename:
        return None
    try:
        value = private_file(Path(filename))
        counts = value['counts']
        if set(counts) != AUDIT_FIELDS or any(type(v) is not int or v < 0 for v in counts.values()):
            return None
        return dict(time=parse_time(value['time']).isoformat(), counts=counts)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def release_info():
    """The pinned release the installer recorded, or nothing: never a guess."""
    try:
        value = json.loads(RELEASE_FILE.read_text())
        if re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', value['tag']) and re.fullmatch(r'[a-f0-9]{40}', value['commit']):
            return dict(version=value['tag'][1:], release=dict(tag=value['tag'], commit=value['commit']))
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return dict(version=None, release=None)


def enforcement_state(policy):
    try:
        policy.list()
        store_ok = True
    except Exception:
        store_ok = False
    return dict(authserv_configured=bool(os.environ.get('MAIL_TRUSTED_AUTHSERV_ID', '').strip()),
                store_ok=store_ok, audit=audit_summary())


def journal_ok():
    path = Path(os.environ.get('PROTON_ACTION_LOG', '/var/lib/proton-mail/actions/actions.jsonl'))
    try:
        info = path.parent.lstat()
        good = stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077
        if path.exists() or path.is_symlink():
            info = path.lstat()
            good = good and stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077 and info.st_nlink == 1
        return good
    except OSError:
        return False


def component_checks(policy):
    """Point-in-time checks recorded with each health probe for the timeline."""
    return {'action_log': journal_ok(), 'allowlist': enforcement_state(policy)['store_ok']}


def state_of(ok, failed):
    if ok + failed == 0:
        return 'unknown'
    return 'ok' if failed == 0 else 'down' if ok == 0 else 'degraded'


def incidents(events):
    """Group failures of one component and class that follow within the gap."""
    groups = []
    for at, component, error_class in sorted(events):
        last = next((g for g in reversed(groups) if g['component'] == component and g['error_class'] == error_class), None)
        if last and at - last['_end'] <= INCIDENT_GAP:
            last['_end'] = at
            last['count'] += 1
        else:
            groups.append(dict(component=component, error_class=error_class, count=1, _start=at, _end=at))
    return [dict(component=g['component'], error_class=g['error_class'], count=g['count'],
                 started_at=g['_start'].isoformat(), ended_at=g['_end'].isoformat())
            for g in sorted(groups, key=lambda g: g['_end'], reverse=True)[:50]]


def core_health(server, range_name='24h', tz=timezone.utc):
    data = server.activity.health()
    now = datetime.now(timezone.utc)
    current = now.isoformat()
    days = RANGES[range_name][0]
    starts, unit = range_window(range_name, tz, now)
    first = starts[0]
    probes = server.activity.health_store.rows(days + 1) if server.activity.health_store is not None else []
    calls = server.activity.rows(days + 1)
    enforcement = enforcement_state(server.policy)
    listener_ok = server.listener_healthy() if server.listener_healthy else True
    checks = {'action_log': journal_ok(), 'allowlist': enforcement['store_ok']}
    timelines = {key: {s: [0, 0] for s in starts} for key in ('bridge', 'mcp', 'action_log', 'allowlist')}
    events = []
    for row in probes:
        at = parse_time(row['time'])
        if at < first:
            continue
        key = floor_time(at, unit, tz)
        if 'connected' in row and (row.get('login_ms', 0) > 0 or row.get('error_class')):
            if key in timelines['bridge']:
                timelines['bridge'][key][0 if row.get('connected') else 1] += 1
            if not row.get('connected'):
                events.append((at, 'bridge', row.get('error_class') or 'internal'))
        for name, good in (row.get('checks') or {}).items():
            if name in ('action_log', 'allowlist') and type(good) is bool and key in timelines[name]:
                timelines[name][key][0 if good else 1] += 1
                if not good:
                    events.append((at, name, 'unavailable'))
    for row in calls:
        at = parse_time(row['time'])
        if at < first:
            continue
        key = floor_time(at, unit, tz)
        failed = row['outcome'] == 'error'
        if key in timelines['mcp']:
            timelines['mcp'][key][1 if failed else 0] += 1
        if failed:
            events.append((at, 'mcp', row.get('error_class') or 'internal'))
    # The current check always counts towards the latest bucket.
    latest = starts[-1]
    for name, good in (('action_log', checks['action_log']), ('allowlist', checks['allowlist'])):
        timelines[name][latest][0 if good else 1] += 1
    def component(ident, name, good):
        return dict(id=ident, name=name, state='ok' if good else 'down', latency_ms=None,
                    p50_ms=None, p95_ms=None, latency=[], errors_24h=0 if good else 1,
                    failures=[] if good else [{'error_class': 'unavailable', 'count': 1}],
                    last_success_at=current if good else None, last_error_at=None if good else current,
                    error_class=None if good else 'unavailable')
    data['components'] += [component('mcp', 'MCP listener', listener_ok),
                           component('action_log', 'Action log', checks['action_log']),
                           component('allowlist', 'Allowlist store', checks['allowlist'])]
    day_ago = now - timedelta(days=1)
    mcp = data['components'][1]
    tool_errors = [r for r in calls if r['outcome'] == 'error' and parse_time(r['time']) >= day_ago]
    mcp['errors_24h'] += len(tool_errors)
    for error_class, count in Counter(r.get('error_class') or 'internal' for r in tool_errors).items():
        mcp['failures'].append({'error_class': error_class, 'count': count})
    if tool_errors and mcp['state'] == 'ok':
        mcp['last_error_at'], mcp['error_class'] = tool_errors[-1]['time'], tool_errors[-1].get('error_class')
    for item in data['components']:
        item['failures'] = sorted(item['failures'], key=lambda f: -f['count'])
        item['timeline'] = [dict(start=k.isoformat(), state=state_of(*v), ok=v[0], failed=v[1]) for k, v in timelines[item['id']].items()]
    if not (listener_ok and checks['action_log'] and checks['allowlist']):
        data['state'] = 'down'
    data['checked_at'] = current
    data['range'] = range_name
    data['bucket_seconds'] = bucket_seconds(unit)
    data['incidents'] = incidents(events)
    data['enforcement'] = enforcement
    data['about'] = release_info()
    return data


def tz_of(query):
    values = query.get('tz', ['UTC'])
    return zone(values[0] if len(values) == 1 else 'UTC')


def range_of(query, default):
    values = query.get('range', [default])
    if len(values) != 1 or values[0] not in RANGES:
        raise ValueError()
    return values[0]


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
        except ValueError as error:
            if str(error) == 'Address already exists':
                self.reply(409, {'error': 'That address is already on the allowlist'})
            else:
                self.reply(400, {'error': 'Invalid request'})
        except (TypeError, UnicodeError):
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
                return self.reply(201, {'entry': public_entry(policy.edit(changes=body))})
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
                    return self.reply(200, {} if self.command == 'DELETE' else {'entry': public_entry(entry)})
            if len(parts) == 4 and parts[3] == 'restore' and self.command == 'POST':
                if body:
                    raise ValueError()
                try:
                    entry = policy.restore(parts[2])
                except ValueError:
                    return self.reply(409, {'error': 'That address is already on the allowlist'})
                entry = next(e for e in policy_payload(policy)['entries'] if e['id'] == entry['id'])
                entry.pop('edit_history', None)
                return self.reply(200, {'entry': entry})
        if self.command == 'GET' and parsed.path == '/api/overview':
            return self.reply(200, overview(self.server.activity, range_of(query, '7d'), self.server.policy,
                                            enforcement_state(self.server.policy), tz_of(query)))
        if self.command == 'GET' and parsed.path == '/api/health':
            return self.reply(200, core_health(self.server, range_of(query, '24h'), tz_of(query)))
        if self.command == 'GET' and parsed.path == '/api/activity':
            return self.reply(200, activity_query(self.server.activity, query))
        if self.command == 'GET' and len(parts) == 3 and parts[:2] == ['api', 'activity'] and re.fullmatch(CALL_ID, parts[2]):
            return self.reply(200, call_detail(parts[2], self.server.activity.rows()))
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
