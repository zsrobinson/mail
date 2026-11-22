# Mail web API

The web server never talks to Bridge or the mailbox. It forwards a fixed set of
routes to the private core API on the Unix socket named by `MAIL_CORE_SOCKET`,
adding the caller's `Cf-Access-Jwt-Assertion`. The core verifies that assertion
again before answering. Nothing in these shapes carries a subject, body,
sender, recipient, folder name or message identity except allowlist addresses,
which the operator entered. Ids are opaque strings (the core uses UUIDs); the
web server accepts `^[A-Za-z0-9_-]{1,64}$`.

All times are ISO 8601 UTC strings. Counts are non-negative integers. Errors are
`{ "error": string }` with a 4xx or 5xx status; the web server passes a core
4xx message through and replaces anything else with a generic message.

## Shared vocabulary

| Name        | Values                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Range`     | `24h`, `7d`, `30d`                                                                                                                                                                                                       |
| `Tool`      | `list_folders`, `list_messages`, `search_messages`, `list_unsubscribe`, `read_messages`, `create_draft`, `archive_messages`, `unarchive_messages`, `move_messages`, `add_labels`, `mark_read`, `list_actions`, `unknown` |
| `Outcome`   | `ok`, `refused`, `error`, `busy`                                                                                                                                                                                         |
| `WriteKind` | `archive`, `unarchive`, `move`, `label`, `mark_read`, `draft`                                                                                                                                                            |
| `State`     | `ok`, `degraded`, `down`, `unknown`                                                                                                                                                                                      |

Chart series are dense: one point per bucket, oldest first, zero-filled.
Overview buckets are 1 hour for `24h` (24 points) and one calendar day for
`7d` (7 points) and `30d` (30 points), so every calls chart in the app labels
the same days. Health status bars use 1 hour, 6 hours (28) and 1 day. `start`
is the bucket's inclusive start.

Calls charts share one vocabulary: `ok` (Succeeded), `refused` (Refused: bodies
withheld by the allowlist) and `error` (Failed, including busy turn-aways).

## Time zones

`overview`, `activity` and `health` take an optional `tz`, an IANA zone name
such as `America/New_York` (`^[A-Za-z0-9_+-]{1,32}(/[A-Za-z0-9_+-]{1,32}){0,2}$`).
Calendar buckets (days, 6-hour blocks, weeks) start at local midnight in that
zone; an unknown zone falls back to UTC. `start` values stay ISO UTC instants.

## GET /api/overview?range=Range&tz=Zone

`range` defaults to `7d`; anything else is a 400.

```json
{
  "range": "7d",
  "generated_at": "2026-11-20T18:00:00Z",
  "bucket_seconds": 21600,
  "period": {
    "start": "2026-11-13T23:00:00Z",
    "end": "2026-11-20T18:00:00Z",
    "previous_start": "2026-11-07T04:00:00Z"
  },
  "totals": {
    "calls": 412,
    "errors": 9,
    "body_reads_allowed": 37,
    "body_reads_refused": 6,
    "writes": 18,
    "messages_changed": 140,
    "refused_calls": 4,
    "failed": 5,
    "refusals": { "sender_not_allowlisted": 5, "sender_not_verified": 1 }
  },
  "previous": { "...": "the same fields for the previous period" },
  "top_senders": [
    {
      "id": "3c8e1f20-…",
      "address": "updates@example.org",
      "matches": 12,
      "state": "active"
    }
  ],
  "attention": [
    {
      "kind": "expiring",
      "severity": "warning",
      "entry_id": "3c8e1f20-…",
      "address": "updates@example.org",
      "time": "2026-11-22T04:59:59Z"
    }
  ],
  "calls": [
    { "start": "2026-11-13T05:00:00Z", "ok": 14, "refused": 1, "error": 1 }
  ],
  "body_reads": [
    { "start": "2026-11-13T18:00:00Z", "allowed": 2, "refused": 0 }
  ],
  "writes_by_kind": [{ "kind": "archive", "calls": 6, "messages": 140 }],
  "bridge": {
    "state": "ok",
    "checked_at": "2026-11-20T17:59:30Z",
    "latency_ms": 84,
    "last_success_at": "2026-11-20T17:59:30Z",
    "latency": [{ "time": "2026-11-20T17:00:00Z", "ms": 91 }]
  }
}
```

- `calls[].refused` counts refused calls; `calls[].error` counts failed and
  busy calls. `totals.errors` is every call that did not succeed;
  `totals.refused_calls` and `totals.failed` split it the same way.
- `body_reads` counts messages, not calls: `allowed` were returned, `refused`
  were withheld by the allowlist (both refusal reasons).
- `writes_by_kind` lists every `WriteKind`, zero included, in the order above.
  `messages` is the number of messages changed; drafts count one each.
- `previous` covers the period of the same length just before `period.start`,
  for deltas.
- `top_senders` lists up to five allowlist entries by matches since the start
  of the period's first local day; `state` is `active`, `expiring` (within 7
  days) or `expired`.
- `attention` is empty when nothing needs a look. `kind` is one of
  `allowlist_unavailable`, `authserv_missing`, `audit_refuses_all`, `bridge`
  (with `state`), `refusal_spike` (with `count` and `previous`: at least 5
  refusals and at least double the previous period), `expiring` or `expired`
  (within the last 7 days; with `entry_id`, `address` and `time`). `severity`
  is `critical`, `warning` or `info`, most urgent first.
- `bridge` summarises the health `bridge` component: `latency` is its recent
  login samples, oldest first, with `ms: null` for a failed login.
  `latency_ms`, `checked_at` and `last_success_at` may be `null`.

## GET /api/activity

Every parameter is optional. The web server rebuilds the query from checked
values and drops anything else.

| Parameter  | Meaning                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `q`        | Up to 200 characters; every word must match the tool, outcome, error class, refusal reason or an id (fixed vocabulary only) |
| `from`     | ISO time, inclusive                                                                                                         |
| `to`       | ISO time, exclusive                                                                                                         |
| `tool`     | Comma-separated `Tool` values                                                                                               |
| `outcome`  | Comma-separated `Outcome` values                                                                                            |
| `refusals` | `1` for calls that withheld at least one body                                                                               |
| `offset`   | Rows to skip, default 0                                                                                                     |
| `limit`    | 1–200, default 50                                                                                                           |
| `tz`       | Zone for the series buckets                                                                                                 |

```json
{
  "rows": [
    {
      "id": "0a6d1e2796feca07ba34c92f275aaa08",
      "time": "2026-11-20T17:42:10Z",
      "tool": "read_messages",
      "outcome": "refused",
      "duration_ms": 412.5,
      "login_ms": 61.2,
      "connected": true,
      "error_class": null,
      "action_id": null,
      "dry_run": false,
      "source_action_id": null,
      "chunks": [],
      "counts": {
        "requested": 3,
        "returned": 2,
        "refused": { "sender_not_allowlisted": 1, "sender_not_verified": 0 },
        "moved": 0,
        "labelled": 0,
        "marked": 0,
        "drafts": 0
      }
    }
  ],
  "total": 1310,
  "offset": 0,
  "limit": 50,
  "truncated": true,
  "series": {
    "bucket_seconds": 86400,
    "points": [
      { "start": "2026-11-13T05:00:00Z", "ok": 40, "refused": 2, "error": 1 }
    ]
  }
}
```

- Newest first. `total` counts every matching call; `truncated` is true when
  more rows follow this page.
- `id` is a 32-character hex call id. Calls recorded before ids existed get a
  stable id derived from the stored record.
- `outcome` is `refused` when bodies were withheld by the allowlist, `busy`
  when another mail operation held the lock, and `error` for anything else
  that failed, including deadlines.
- `error_class` is a fixed class name such as `deadline`, `stopped`,
  `PublicError` or `OSError`, never an exception message.
- `series` covers the filtered calls: hourly up to 2 days, daily up to 92
  days, otherwise weekly. Without `from` it starts at
  the oldest matching call. `ok` counts succeeded calls, `refused` refused
  calls and `error` failed and busy calls.

## GET /api/activity/:id

One call by its id, with its action for writes:

```json
{ "call": { "...": "an activity row" }, "action": null }
```

`action` has the shape of `GET /api/actions/:id`, or `null` for reads.

## GET /api/actions/:id

Metadata only: no folder names, UIDs or message details.

```json
{
  "id": "6f1c2a9e-3b7d-4c1e-9a52-0d8e4f7b6c31",
  "tool": "archive_messages",
  "kind": "archive",
  "time": "2026-11-20T16:05:00Z",
  "dry_run": false,
  "status": "completed",
  "counts": { "requested": 42, "completed": 42, "uncertain": 0, "failed": 0 },
  "chunks": [{ "index": 0, "size": 42, "status": "completed" }],
  "call_id": "0a6d1e2796feca07ba34c92f275aaa08",
  "source_action_id": null,
  "unarchive": {
    "eligible": true,
    "reason": null,
    "restored_by": null
  }
}
```

- `status` and `chunks[].status` are `completed`, `partial`, `uncertain`,
  `failed` or `dry_run`.
- `call_id` is the call that made the action; `source_action_id` is the
  archive an unarchive restored.
- `unarchive` is present only for `kind: "archive"`. When `eligible` is false,
  `reason` is a short operator-facing sentence, for example that the action
  has uncertain chunks or lacks complete COPYUID mappings. `restored_by` is the
  id of a later unarchive action, if one exists.

## POST /api/actions/:id/unarchive

Two steps. The web UI always previews first and only confirms with the token
from that preview.

Preview, body `{ "dry_run": true }`:

```json
{
  "dry_run": true,
  "preview_token": "opaque",
  "expires_at": "2026-11-20T18:05:00Z",
  "messages": 42,
  "chunks": 1
}
```

Confirm, body `{ "dry_run": false, "preview_token": "opaque" }`:

```json
{
  "dry_run": false,
  "action_id": "0b9d7e44-1f2a-4e63-8c1d-5a7b9e2f3c10",
  "status": "completed",
  "counts": { "requested": 42, "completed": 42, "uncertain": 0, "failed": 0 }
}
```

The core rejects a missing, expired or reused token with 409 and refuses
ineligible actions with 409. The web server forwards only these two body
shapes.

## GET /api/allowlist

```json
{
  "entries": [
    {
      "id": "3c8e1f20-7a4b-4d9e-b6c2-1e5f8a9d0b47",
      "address": "updates@example.org",
      "note": "Shipping notices",
      "added_at": "2026-10-02T14:00:00Z",
      "expires_at": null,
      "last_matched_at": "2026-11-20T09:12:00Z",
      "match_count": 31,
      "matches": [{ "date": "2025-11-20", "count": 0 }]
    }
  ],
  "history": [{ "time": "2026-11-18T10:00:00Z", "change": "added" }]
}
```

- `address` is one exact ASCII address, lower-cased. There are no domain-wide
  entries.
- `matches` is the last 366 calendar days (UTC), oldest first, zero-filled.
  The UI charts 30 days, 90 days or the full year from it.
- `history` is the newest 50 list changes across all entries. History items
  carry only `time` and `change`.

## POST /api/allowlist

Body `{ "address": string, "note": string, "expires_at": string | null }`.
Returns `201` with `{ "entry": Entry }`, `409` for a duplicate address and
`400` for an invalid address, a note over 1000 characters or a past expiry.
The web server already rejects those, trims the note, lower-cases the address
and drops unknown fields. An expiry picked as a date is sent as 23:59:59 on
that day in the viewer's own time zone, and the form says which zone.

## GET /api/allowlist/:id

```json
{
  "entry": {
    "id": "3c8e1f20-…",
    "address": "updates@example.org",
    "...": "Entry fields"
  },
  "history": [{ "time": "2026-11-18T10:00:00Z", "change": "note_changed" }]
}
```

`history` here is that entry's changes, newest first.

## PATCH /api/allowlist/:id

Body with any of `address`, `note`, `expires_at`. Returns `{ "entry": Entry }`.
Each changed field adds its own history item.

## DELETE /api/allowlist/:id

Returns `{}`. The entry leaves the allowlist immediately and stops matching;
the core keeps it, with its matches and history, among the last 100 removals.

## POST /api/allowlist/:id/restore

No body. Undoes a removal: the same entry returns with its id, matches and
history. Returns `{ "entry": Entry }`, `404` when the entry is not among the
kept removals and `409` when its address is on the list again. A restore is
recorded as `added`.

`change` values: `added`, `address_changed`, `note_changed`,
`expiry_changed`, `expired`, `removed`. The UI shows unknown values verbatim.

## GET /api/health?range=Range&tz=Zone

`range` defaults to `24h`.

```json
{
  "checked_at": "2026-11-20T17:59:30Z",
  "state": "ok",
  "range": "24h",
  "bucket_seconds": 3600,
  "incidents": [
    {
      "component": "bridge",
      "error_class": "TimeoutError",
      "count": 2,
      "started_at": "2026-11-20T11:00:00Z",
      "ended_at": "2026-11-20T11:08:00Z"
    }
  ],
  "enforcement": {
    "authserv_configured": true,
    "store_ok": true,
    "audit": {
      "time": "2026-11-18T09:00:00Z",
      "counts": {
        "scanned": 1000,
        "candidates": 4210,
        "allowlisted_sender": 64,
        "authenticated_allowlisted": 61,
        "unverified_allowlisted": 3,
        "with_authentication_results": 998,
        "with_trusted_topmost": 996
      }
    }
  },
  "about": {
    "version": "0.4.2",
    "release": { "tag": "v0.4.2", "commit": "<40 hex>" }
  },
  "components": [
    {
      "id": "bridge",
      "name": "Bridge login",
      "state": "ok",
      "latency_ms": 84,
      "p50_ms": 79,
      "p95_ms": 160,
      "latency": [{ "time": "2026-11-20T17:00:00Z", "ms": 91 }],
      "errors_24h": 1,
      "failures": [{ "error_class": "TimeoutError", "count": 1 }],
      "last_success_at": "2026-11-20T17:59:30Z",
      "last_error_at": "2026-11-20T11:00:00Z",
      "error_class": "TimeoutError",
      "timeline": [
        {
          "start": "2026-11-19T18:00:00Z",
          "state": "ok",
          "ok": 60,
          "failed": 0
        }
      ]
    }
  ]
}
```

- `state` is the worst component state.
- Bridge health uses serialized login/NOOP probes and real tool-call login samples.
  Probes never select a mailbox or fetch a message; they skip busy periods.
  The other health components use process state or safe ownership/permission checks,
  without reading the existing action journal.
- Component `id`s: `bridge` (Bridge login samples from MCP calls), `mcp` (the
  MCP HTTP listener), `action_log` (private, writable journal) and `allowlist`
  (readable store). Unknown ids render with their `name`.
- `latency` holds up to 24 recent samples, oldest first; `ms` is `null` for a
  failed login. `p50_ms` and `p95_ms` cover the last 24 hours. Components
  without a latency measure send `null` for all three and an empty `latency`.
- `failures` counts the last 24 hours of failures by `error_class`, largest
  first. `error_class` is the most recent failure class, never a message.
  The `mcp` component also counts tool calls that ended in `error`.
- `timeline` has one bucket per hour (24h), 6 hours (7d) or day (30d), oldest
  first: `ok` with no failures, `degraded` with some, `down` with only
  failures, `unknown` with no samples. Bridge uses login probes and tool-call
  logins; `mcp` uses tool calls; `action_log` and `allowlist` use the checks
  recorded with each probe.
- `incidents` groups failures of one component and class that follow within
  15 minutes, newest first, at most 50.
- `enforcement.authserv_configured` says only whether a trusted authserv id is
  set, never the value. `audit` is the last aggregate header audit, when
  `MAIL_AUTH_AUDIT_RESULT` names its private result file, or `null`.
- `about.release` is the tag and commit an installer recorded in
  `release.json` beside the core, and `about.version` is that tag without
  the `v`. Both are `null` when nothing was recorded; the core never reports a
  version of its own.

## Build and run

`npm ci && npm run build` writes the static app to `dist/` and the server to
`dist-server/server.js`, one self-contained ESM bundle with no runtime
`node_modules`. Run `node dist-server/server.js` with Node 22 or newer from any
working directory; it serves the sibling `dist/`. Fixture code is not in the
bundle, and the bundle refuses to start when `MAIL_FIXTURES` is set.

| Variable           | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `ACCESS_ISSUER`    | Access team origin, `https://<team>.cloudflareaccess.com`          |
| `ACCESS_AUD`       | Access application audience tag                                    |
| `PUBLIC_ORIGIN`    | Exact browser origin; other origins cannot mutate                  |
| `SERVICE_MANIFEST` | JSON array of `{ name, url, icon?, colour? }` for the app switcher |
| `MAIL_CORE_SOCKET` | Path of the core API Unix socket                                   |
| `METRICS_TOKEN`    | Bearer token for `/metrics`; unset disables it                     |
| `PORT`             | Listen port, default `8787`                                        |
| `BIND_ADDRESS`     | Listen address, default `127.0.0.1`                                |

Every request, including assets, needs a valid Access assertion. Request logs
carry only a fixed event, outcome and duration.

## Fixtures

`npm run dev:fixtures` with `npm run dev` serves these shapes from synthetic
data with `example.org`, `example.net` and `example.com` addresses. It refuses
to start when `ACCESS_ISSUER`, `ACCESS_AUD`, `PUBLIC_ORIGIN` or
`MAIL_CORE_SOCKET` is set, when `NODE_ENV` is `production`, or when bound to
anything other than loopback.
