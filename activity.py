"""One metadata-only record per call; daily rotation with 366-day retention."""
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
import re
from pathlib import Path
import stat
import threading
from uuid import uuid4

TOOLS = frozenset(('list_folders', 'list_messages', 'search_messages', 'list_unsubscribe', 'read_messages', 'create_draft', 'archive_messages', 'move_messages', 'add_labels', 'mark_read', 'list_actions', 'unarchive_messages'))
REASONS = ('sender_not_allowlisted', 'sender_not_verified')
BOUNDS = (.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10, float('inf'))
ERRORS = frozenset(('deadline', 'stopped', 'PublicError', 'TimeoutError', 'OSError', 'ValueError', 'RuntimeError', 'internal'))


class Activity:
    def __init__(self, filename, health_filename=None):
        self.path = Path(filename)
        self.lock = threading.RLock()
        self.health_store = Activity(health_filename) if health_filename else None
        self.metric_state = None

    def _directory(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        st = self.path.parent.lstat()
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:
            raise ValueError('Activity directory must be owned and private')

    def _open(self, path, write=False):
        fd = os.open(path, os.O_NOFOLLOW | (os.O_WRONLY | os.O_APPEND | os.O_CREAT if write else os.O_RDONLY), 0o600)
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077 or st.st_nlink != 1:
            os.close(fd)
            raise ValueError('Activity file must be owned and private')
        return os.fdopen(fd, 'a' if write else 'r')

    def record(self, telemetry, result, args):
        # Whitelist every emitted field. Never serialize result/arguments.
        args = args if isinstance(args, dict) else {}
        result = result if isinstance(result, dict) else {}
        tool = telemetry.get('tool') if telemetry.get('tool') in TOOLS else 'unknown'
        messages = result.get('messages', [])
        refusals = Counter(m.get('refusal', {}).get('code') for m in messages)
        counts = dict(requested=max(0, int(telemetry.get('requested', 0))),
                      returned=sum('refusal' not in m for m in messages),
                      refused={r: refusals[r] for r in REASONS}, moved=0, labelled=0, marked=0, drafts=0)
        if not args.get('dry_run'):
            field = {'archive_messages': 'moved', 'unarchive_messages': 'moved', 'move_messages': 'moved', 'add_labels': 'labelled', 'mark_read': 'marked'}.get(tool)
            if field:
                counts[field] = len(result.get('completed', []))
            counts['drafts'] = int(tool == 'create_draft' and result.get('saved') is True)
        outcome = 'refused' if any(counts['refused'].values()) else 'busy' if telemetry.get('error_class') == 'busy' else 'ok' if telemetry['outcome'] == 'ok' else 'error'
        action_id = result.get('action_id') or telemetry.get('action_id')
        row = dict(id=uuid4().hex, time=telemetry['ts'], tool=tool, outcome=outcome, counts=counts,
                   duration_ms=telemetry['total_ms'], login_ms=telemetry['phase']['login'],
                   connected=telemetry.get('bridge_ok', False),
                   error_class=telemetry['error_class'] if telemetry['error_class'] in ERRORS else None,
                   action_id=action_id if isinstance(action_id, str) and re.fullmatch(r'[a-f0-9-]{36}', action_id) else None,
                   dry_run=args.get('dry_run') is True,
                   chunks=[{'index': int(c['index']), 'size': int(c['size']), 'status': c['status']} for c in telemetry.get('chunks_meta', []) if c.get('status') in ('completed', 'dry_run', 'uncertain', 'failed')],
                   source_action_id=args.get('action_id') if tool == 'unarchive_messages' and isinstance(args.get('action_id'), str) and re.fullmatch(r'[a-f0-9-]{36}', args['action_id']) else None)
        self.append(row)
        if self.health_store is not None and (telemetry['phase'].get('connect', 0) > 0 or row['login_ms'] > 0):
            self.health_store.append({k: row[k] for k in ('time', 'login_ms', 'connected', 'error_class')})

    def append(self, row):
        with self.lock:
            self._directory()
            today = datetime.now(timezone.utc).date()
            if self.path.exists():
                info = self.path.lstat()
                date = datetime.fromtimestamp(info.st_mtime, timezone.utc).date()
                if date < today:
                    target = self.path.with_name(self.path.name + '.' + date.isoformat())
                    if target.exists():
                        raise ValueError('Activity rotation collision')
                    os.rename(self.path, target)
            for path in self.path.parent.glob(self.path.name + '.????-??-??'):
                date = datetime.strptime(path.name[-10:], '%Y-%m-%d').date()
                if date < today - timedelta(days=366):
                    with self._open(path):
                        pass
                    path.unlink()
            with self._open(self.path, True) as stream:
                stream.write(json.dumps(row, separators=(',', ':')) + '\n')
                stream.flush()
                os.fsync(stream.fileno())
            if self.metric_state is not None:
                self._add_metric(self.metric_state, row)

    def rows(self, days=366):
        with self.lock:
            self._directory()
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            rows = []
            paths = sorted(self.path.parent.glob(self.path.name + '.????-??-??')) + [self.path]
            for path in paths:
                try:
                    with self._open(path) as stream:
                        for line in stream:
                            try:
                                row = json.loads(line)
                                if row['time'] >= cutoff:
                                    # Older records predate call ids; derive a stable one.
                                    if not isinstance(row.get('id'), str) or not re.fullmatch(r'[a-f0-9]{32}', row['id']):
                                        row['id'] = hashlib.sha256(line.rstrip('\n').encode()).hexdigest()[:32]
                                    rows.append(row)
                            except (ValueError, KeyError, TypeError):
                                continue
                except FileNotFoundError:
                    pass
            return rows

    def health(self, rows=None):
        rows = self.health_store.rows(30) if self.health_store is not None else self.rows(30) if rows is None else rows
        cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        latencies = sorted(r['login_ms'] for r in rows if r.get('connected') and r['time'] >= cutoff)
        def percentile(p):
            return latencies[max(0, math.ceil(len(latencies) * p) - 1)] if latencies else None
        successful = [r for r in rows if r.get('connected')]
        recent = [r for r in rows if r.get('login_ms', 0) > 0 or r.get('error_class')]
        last = recent[-1] if recent else None
        fresh = bool(last and (datetime.now(timezone.utc) - datetime.fromisoformat(last['time'])).total_seconds() <= 900)
        state = ('ok' if last.get('connected') else 'down') if fresh else 'unknown'
        failures = [{'error_class': k, 'count': v} for k, v in Counter(r['error_class'] for r in rows if r.get('error_class') and r['time'] >= cutoff).items()]
        latency = [{'time': r['time'], 'ms': r['login_ms'] if r.get('connected') else None} for r in recent[-24:]]
        errors = [r for r in rows if r.get('error_class')]
        component = dict(id='bridge', name='Bridge IMAP', state=state,
                         latency_ms=last['login_ms'] if last and last.get('connected') else None,
                         latency=latency, errors_24h=sum(r['time'] >= (datetime.now(timezone.utc) - timedelta(days=1)).isoformat() for r in errors),
                         last_success_at=successful[-1]['time'] if successful else None,
                         last_error_at=errors[-1]['time'] if errors else None,
                         error_class=errors[-1]['error_class'] if errors else None,
                         latency_p50_ms=percentile(.5), latency_p95_ms=percentile(.95), p50_ms=percentile(.5), p95_ms=percentile(.95), failures=failures)
        return dict(checked_at=last['time'] if last else None, state=state, components=[component],
                    bridge_up=state == 'ok' if state != 'unknown' else None,
                    last_success_at=component['last_success_at'], latency_p50_ms=percentile(.5),
                    latency_p95_ms=percentile(.95), failures=failures)

    @staticmethod
    def _add_metric(state, row):
        if row.get('tool'):
            state['calls'][(row['tool'], row['outcome'])] += 1
            state['refusals'].update(row['counts']['refused'])
            for kind in ('moved', 'labelled', 'marked', 'drafts'):
                state['writes'][kind] += row['counts'][kind]
        if row.get('connected'):
            sample = row['login_ms'] / 1000
            state['latency_count'] += 1
            state['latency_sum'] += sample
            for bound in BOUNDS:
                state['buckets'][bound] += int(sample <= bound)

    def metric_snapshot(self):
        with self.lock:
            if self.metric_state is None:
                self.metric_state = dict(calls=Counter(), refusals=Counter(), writes=Counter(), buckets=Counter(), latency_count=0, latency_sum=0)
                for row in self.rows():
                    self._add_metric(self.metric_state, row)
            return {k: v.copy() if isinstance(v, Counter) else v for k, v in self.metric_state.items()}

    def metrics(self):
        # Counters are initialized from retained history once per process and
        # then incremented; retention never decreases a live counter. A restart
        # is an ordinary Prometheus counter reset when old history has expired.
        state = self.metric_snapshot()
        lines = []
        for (tool, outcome), count in sorted(state['calls'].items()):
            lines.append(f'mail_calls_total{{tool="{tool}",outcome="{outcome}"}} {count}')
        for reason in REASONS:
            lines.append(f'mail_read_refusals_total{{reason="{reason}"}} {state["refusals"][reason]}')
        for kind in ('moved', 'labelled', 'marked', 'drafts'):
            lines.append(f'mail_writes_total{{kind="{kind}"}} {state["writes"][kind]}')
        lines.append(f'mail_bridge_up {int(self.health()["bridge_up"] is True)}')
        health = self.health_store.metric_snapshot() if self.health_store is not None else state
        for bound in BOUNDS:
            label = '+Inf' if math.isinf(bound) else str(bound)
            lines.append(f'mail_imap_login_seconds_bucket{{le="{label}"}} {health["buckets"][bound]}')
        lines += [f'mail_imap_login_seconds_count {health["latency_count"]}', f'mail_imap_login_seconds_sum {health["latency_sum"]}']
        return '\n'.join(lines) + '\n'
