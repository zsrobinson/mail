# Mail web

An Access-protected web UI for the mail core: call volume, body-read refusals,
writes by kind, Bridge login health, an activity log with write-action detail
and Archive-to-INBOX unarchive, and the sender allowlist. It never reads or
shows message content, and it has no way to send mail.

Built on the shared [shell](https://github.com/zsrobinson/shell) (Vite, React,
TanStack Router and Query, Hono), pinned by commit. Update the pin with
`npm run shell:update` and review the lockfile diff.

| Route            | Page                                                  |
| ---------------- | ----------------------------------------------------- |
| `/`              | Overview for the last 24 hours, 7 days or 30 days     |
| `/activity`      | Tool calls filtered by tool and outcome               |
| `/actions/$id`   | One write action, with unarchive preview then confirm |
| `/allowlist`     | Allowed senders, searchable                           |
| `/allowlist/new` | Add a sender                                          |
| `/allowlist/$id` | Matches over time, edit, edit history and removal     |
| `/health`        | Component state, latency percentiles and failures     |

The server forwards a fixed set of validated routes to the private core API on
a Unix socket. [API.md](API.md) is the contract, plus build, run and
configuration details.

## Development

```sh
npm ci
npm run dev:fixtures   # synthetic data on 127.0.0.1:8787
npm run dev            # Vite on 127.0.0.1:5173, proxies /api
npm run check          # types, lint, formatting, tests
npm run build          # dist/ and dist-server/server.js
```

Fixtures use only `example.org`, `example.net` and `example.com` addresses and
refuse to start beside any Access or core configuration.
