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

Chart series are dense: one point per bucket, oldest first, zero-filled. The
bucket is 1 hour for `24h` (24 points), 6 hours for `7d` (28 points) and 1 day
for `30d` (30 points). `start` is the bucket's inclusive start.

## GET /api/overview?range=Range

`range` defaults to `7d`; anything else is a 400.

```json
{
  "range": "7d",
  "generated_at": "2026-11-20T18:00:00Z",
  "bucket_seconds": 21600,
  "totals": {
    "calls": 412,
    "errors": 9,
    "body_reads_allowed": 37,
    "body_reads_refused": 6,
    "writes": 18
  },
  "calls": [{ "start": "2026-11-13T18:00:00Z", "ok": 14, "error": 1 }],
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

- `calls[].error` counts every outcome other than `ok`.
- `body_reads` counts messages, not calls: `allowed` were returned, `refused`
  were withheld by the allowlist (both refusal reasons).
- `writes_by_kind` lists every `WriteKind`, zero included, in the order above.
  `messages` is the number of messages changed; drafts count one each.
- `bridge` summarises the health `bridge` component: `latency` is its recent
  login samples, oldest first, with `ms: null` for a failed login.
  `latency_ms`, `checked_at` and `last_success_at` may be `null`.

## GET /api/activity?tool=Tool&outcome=Outcome

Both filters are optional; an empty value means any. The newest calls come
first, at most 200 rows.

```json
{
  "rows": [
    {
      "time": "2026-11-20T17:42:10Z",
      "tool": "read_messages",
      "outcome": "ok",
      "duration_ms": 412.5,
      "login_ms": 61.2,
      "error_class": null,
      "action_id": null,
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
  "truncated": false
}
```

- `action_id` is set for mailbox writes and links to `/api/actions/:id`.
- `outcome` is `refused` for a controlled refusal, `busy` when another mail
  operation held the lock, and `error` for anything else that failed,
  including deadlines.
- `error_class` is a class name such as `deadline`, `stopped`, `PublicError`
  or `OSError`, never an exception message.
- `login_ms` is `null` when the call did not log in to Bridge.
- `truncated` is true when older matching rows exist beyond the limit.

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
  "unarchive": {
    "eligible": true,
    "reason": null,
    "restored_by": null
  }
}
```

- `status` and `chunks[].status` are `completed`, `partial`, `uncertain`,
  `failed` or `dry_run`.
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
and drops unknown fields. An expiry picked as a date is sent as the end of that
UTC day.

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

## DELETE /api/allowlist/:id

Returns `{}`.

`change` values: `added`, `address_changed`, `note_changed`,
`expiry_changed`, `expired`, `removed`. The UI shows unknown values verbatim.

## GET /api/health

```json
{
  "checked_at": "2026-11-20T17:59:30Z",
  "state": "ok",
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
      "error_class": "TimeoutError"
    }
  ]
}
```

- `state` is the worst component state.
- Health is passive: it reports what real tool calls observed. There are no
  active probes.
- Component `id`s: `bridge` (Bridge login samples from MCP calls), `mcp` (the
  MCP HTTP listener), `action_log` (private, writable journal) and `allowlist`
  (readable store). Unknown ids render with their `name`.
- `latency` holds up to 24 recent samples, oldest first; `ms` is `null` for a
  failed login. `p50_ms` and `p95_ms` cover the last 24 hours. Components
  without a latency measure send `null` for all three and an empty `latency`.
- `failures` counts the last 24 hours of failures by `error_class`, largest
  first. `error_class` is the most recent failure class, never a message.

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
carry only method, route pattern, status and duration.

## Fixtures

`npm run dev:fixtures` with `npm run dev` serves these shapes from synthetic
data with `example.org`, `example.net` and `example.com` addresses. It refuses
to start when `ACCESS_ISSUER`, `ACCESS_AUD`, `PUBLIC_ORIGIN` or
`MAIL_CORE_SOCKET` is set, when `NODE_ENV` is `production`, or when bound to
anything other than loopback.
