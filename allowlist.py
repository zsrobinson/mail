"""Private, fail-closed sender policy. No MCP management surface."""
from datetime import date, datetime, timezone
from email import policy
from email.parser import BytesParser
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import threading
from uuid import uuid4


def now():
    return datetime.now(timezone.utc).isoformat()


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Timezone required')
    return parsed


def address(value):
    # ASCII addresses only: Unicode homographs never normalize into an approval.
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", value):
        raise ValueError('Use one ASCII email address')
    local, domain = value.rsplit('@', 1)
    if len(local) > 64 or len(domain) > 253 or '..' in local or local.startswith('.') or local.endswith('.') or any(not p or len(p) > 63 or p.startswith('-') or p.endswith('-') for p in domain.split('.')):
        raise ValueError('Invalid address')
    return value.lower()


def sender(headers):
    values = headers.get_all('From', [])
    if len(values) != 1 or values[0].defects:
        return None
    try:
        addresses = values[0].addresses
        if len(addresses) != 1:
            return None
        return address(addresses[0].addr_spec)
    except (ValueError, AttributeError):
        return None


def authenticated(headers, domain, authserv):
    # The first Authentication-Results must be the receiver's. Never scan down
    # to a matching attacker-supplied upstream header. Strict alignment is used.
    values = headers.get_all('Authentication-Results', [])
    if not authserv or not re.fullmatch(r'[A-Za-z0-9.-]+', authserv) or not values:
        return False
    value = str(values[0])
    # Remove RFC comments, including nested comments, before parsing clauses.
    for _ in range(20):
        cleaned = re.sub(r'\((?:[^()\\]|\\.)*\)', '', value)
        if cleaned == value:
            break
        value = cleaned
    if '(' in value or ')' in value:
        return False
    clauses = value.split(';')
    service = re.fullmatch(r'\s*([A-Za-z0-9.-]+)(?:\s+[1-9][0-9]*)?\s*', clauses[0])
    if not service or service[1].lower() != authserv.lower():
        return False
    for clause in clauses[1:]:
        match = re.fullmatch(r'\s*(dmarc|dkim)\s*=\s*pass\b(.*)', clause, re.I | re.S)
        if not match:
            continue
        key = 'header.from' if match[1].lower() == 'dmarc' else 'header.d'
        identities = re.findall(r'(?:^|\s)' + re.escape(key) + r'\s*=\s*(?:"([A-Za-z0-9.-]+)"|([A-Za-z0-9.-]+))(?=\s|$)', match[2], re.I)
        if len(identities) == 1 and (identities[0][0] or identities[0][1]).lower() == domain:
            return True
    return False


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate policy field')
        result[key] = value
    return result


def check_history(rows):
    if not isinstance(rows, list):
        raise ValueError('Invalid edit history')
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'time', 'change'} or row['change'] not in ('added', 'updated', 'removed', 'address_changed', 'note_changed', 'expiry_changed', 'expired'):
            raise ValueError('Invalid edit history')
        timestamp(row['time'])


class Allowlist:
    def __init__(self, filename):
        self.path = Path(filename)
        self.lock = threading.RLock()
        self.cached = None
        self.stamp = None

    def _check(self):
        parent = self.path.parent.lstat()
        if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
            raise ValueError('Policy directory must be owned and private')

    def _load(self):
        self._check()
        fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1 or info.st_size > 4 * 1024 * 1024:
                raise ValueError('Policy file must be owned and private')
            stamp = (info.st_ino, info.st_mtime_ns, info.st_ctime_ns, info.st_size)
            if stamp == self.stamp and self.cached is not None:
                return self.cached
            data = json.load(stream, object_pairs_hook=unique_object)
        if not isinstance(data, dict) or type(data.get('version')) is not int or data.get('version') != 1 or not isinstance(data.get('entries'), list) or not isinstance(data.get('history'), list):
            raise ValueError('Invalid policy')
        check_history(data['history'])
        ids, addresses = set(), set()
        for entry in data['entries']:
            if not isinstance(entry, dict) or address(entry['address']) != entry['address'] or entry['id'] in ids or entry['address'] in addresses:
                raise ValueError('Invalid entry')
            if not isinstance(entry['id'], str) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', entry['id']):
                raise ValueError('Invalid entry identity')
            check_history(entry.get('edit_history', []))
            ids.add(entry['id'])
            addresses.add(entry['address'])
            timestamp(entry['added_at'])
            if entry.get('expires_at'):
                timestamp(entry['expires_at'])
            if not isinstance(entry.get('note'), str) or len(entry['note']) > 1000 or any(ord(c) < 32 for c in entry['note']) or type(entry.get('match_count')) is not int or entry['match_count'] < 0:
                raise ValueError('Invalid entry')
            if entry.get('last_matched_at'):
                timestamp(entry['last_matched_at'])
            matches = entry.get('matches', [])
            if not isinstance(matches, list) or len(matches) > 366:
                raise ValueError('Invalid match history')
            previous = ''
            for row in matches:
                if not isinstance(row, dict) or set(row) != {'date', 'count'} or type(row['count']) is not int or row['count'] < 0 or not isinstance(row['date'], str) or date.fromisoformat(row['date']).isoformat() != row['date'] or row['date'] <= previous:
                    raise ValueError('Invalid match history')
                previous = row['date']
        self.cached, self.stamp = data, stamp
        return data

    def _save(self, data):
        self._check()
        # Verify existing file permissions and type before replacing it.
        self._load()
        fd, filename = tempfile.mkstemp(prefix='.allowlist-', dir=self.path.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump(data, stream, ensure_ascii=True)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(filename, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            self.stamp = None
        finally:
            if os.path.exists(filename):
                os.unlink(filename)

    def list(self):
        with self.lock:
            # Return a copy so mutation cannot change the cached snapshot.
            return json.loads(json.dumps(self._load()))

    def edit(self, ident=None, changes=None, remove=False):
        with self.lock:
            data = self.list()
            changes = changes or {}
            if set(changes) - {'address', 'note', 'expires_at'}:
                raise ValueError('Unknown entry field')
            item = next((e for e in data['entries'] if e['id'] == ident), None)
            if ident and not item:
                raise KeyError('Entry not found')
            if remove:
                data['entries'].remove(item)
            else:
                if item is None:
                    item = dict(id=str(uuid4()), added_at=now(), last_matched_at=None, match_count=0, matches=[], note='', expires_at=None)
                    data['entries'].append(item)
                item.update(changes)
                item['address'] = address(item.get('address'))
                if not isinstance(item['note'], str) or len(item['note']) > 1000 or any(ord(c) < 32 for c in item['note']):
                    raise ValueError('Invalid note')
                if item.get('expires_at'):
                    timestamp(item['expires_at'])
                if sum(e['address'] == item['address'] for e in data['entries']) != 1:
                    raise ValueError('Address already exists')
            # Edit history deliberately contains time and operation only.
            event = {'time': now(), 'change': 'removed' if remove else 'updated' if ident else 'added'}
            data['history'].append(event)
            if not remove:
                item.setdefault('edit_history', []).append(event)
                item['edit_history'] = item['edit_history'][-1000:]
            data['history'] = data['history'][-10000:]
            self._save(data)
            return item

    def decision(self, raw, authserv, record=True):
        try:
            headers = BytesParser(policy=policy.default).parsebytes(raw, headersonly=True)
            origin = sender(headers)
            with self.lock:
                data = self.list()
                entry = next((e for e in data['entries'] if e['address'] == origin and (not e.get('expires_at') or timestamp(e['expires_at']) > datetime.now(timezone.utc))), None)
                if not entry:
                    return 'sender_not_allowlisted'
                if not authenticated(headers, origin.rsplit('@', 1)[1], authserv):
                    return 'sender_not_verified'
                if record:
                    entry['match_count'] += 1
                    entry['last_matched_at'] = now()
                    day = now()[:10]
                    matches = entry.setdefault('matches', [])
                    if matches and matches[-1]['date'] == day:
                        matches[-1]['count'] += 1
                    else:
                        matches.append({'date': day, 'count': 1})
                    entry['matches'] = matches[-366:]
                    self._save(data)
                return None
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            self.cached = self.stamp = None
            return 'sender_not_allowlisted'
