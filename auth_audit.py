"""Owner-run, aggregate-only header audit. No body fetches or action-log access."""
import email.policy
from email.parser import BytesParser
import json
import os
from allowlist import sender
from mail_mcp import connect, ok, sender_policy


def audit(client, policy, authserv, limit=1000):
    counts = dict(scanned=0, allowlisted_sender=0, authenticated_allowlisted=0,
                  unverified_allowlisted=0, with_authentication_results=0,
                  with_trusted_topmost=0, candidates=0)
    entries = {entry['address'] for entry in policy.list()['entries']}
    for folder in ('INBOX', 'Archive'):
        ok(client.select('"' + folder + '"', readonly=True))
        uids = ok(client.uid('SEARCH', None, 'ALL'))[0].split()
        counts['candidates'] += len(uids)
        for uid in uids[-limit:]:
            data = ok(client.uid('FETCH', uid.decode('ascii'), '(UID BODY.PEEK[HEADER.FIELDS (From Authentication-Results)]<0.65537>)'))
            rows = [r for r in data if isinstance(r, tuple)]
            if len(rows) != 1 or len(rows[0][1]) > 65536:
                continue
            raw = rows[0][1]
            headers = BytesParser(policy=email.policy.default).parsebytes(raw, headersonly=True)
            values = headers.get_all('Authentication-Results', [])
            counts['scanned'] += 1
            counts['with_authentication_results'] += bool(values)
            counts['with_trusted_topmost'] += bool(values and str(values[0]).split(';')[0].strip().lower() == authserv.lower())
            if sender(headers) in entries:
                reason = policy.decision(raw, authserv, record=False)
                if reason != 'sender_not_allowlisted':
                    counts['allowlisted_sender'] += 1
                    counts['authenticated_allowlisted'] += reason is None
                    counts['unverified_allowlisted'] += reason == 'sender_not_verified'
    return counts


if __name__ == '__main__':
    client = None
    try:
        client = connect()
        result = audit(client, sender_policy(), os.environ['MAIL_TRUSTED_AUTHSERV_ID'])
        print(json.dumps(result, sort_keys=True))
    except Exception:
        raise SystemExit('Aggregate header audit unavailable; no mail values logged') from None
    finally:
        if client:
            try:
                client.logout()
            except Exception:
                pass
