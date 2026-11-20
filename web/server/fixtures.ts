/**
 * Synthetic development data. Nothing here is derived from a mailbox: every
 * address is on example.org, example.net or example.com, and every count is
 * generated from a fixed seed relative to the current time.
 */
import type {
  Action,
  ActionStatus,
  ActivityRow,
  AllowlistEntry,
  Health,
  HistoryItem,
  LatencyPoint,
  Outcome,
  Overview,
  Range,
  Tool,
  WriteKind,
} from "../src/lib/types.ts"
import { WRITE_KINDS } from "../src/lib/types.ts"
import type { CoreRequest, CoreResponse, Forward } from "./routes.ts"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const CHUNK = 50
const MATCH_DAYS = 366

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(next: () => number, weights: [T, number][]) {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = next() * total
  for (const [value, weight] of weights) {
    roll -= weight
    if (roll < 0) return value
  }
  return weights[weights.length - 1][0]
}

const int = (next: () => number, min: number, max: number) =>
  min + Math.floor(next() * (max - min + 1))

/** A deterministic version 4 UUID from the fixture's random stream. */
function uuid(next: () => number) {
  const hex = Array.from({ length: 32 }, () =>
    Math.floor(next() * 16).toString(16)
  )
  hex[12] = "4"
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16)
  const h = hex.join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const KIND: Partial<Record<Tool, WriteKind>> = {
  archive_messages: "archive",
  unarchive_messages: "unarchive",
  move_messages: "move",
  add_labels: "label",
  mark_read: "mark_read",
  create_draft: "draft",
}

const TOOL_WEIGHTS: [Tool, number][] = [
  ["search_messages", 30],
  ["list_messages", 20],
  ["read_messages", 15],
  ["list_folders", 5],
  ["list_unsubscribe", 4],
  ["archive_messages", 8],
  ["mark_read", 6],
  ["add_labels", 3],
  ["move_messages", 3],
  ["create_draft", 2],
  ["list_actions", 3],
  ["unarchive_messages", 1],
]

type Event = ActivityRow & { id: number }
type StoredAction = Action

function emptyCounts() {
  return {
    requested: 0,
    returned: 0,
    refused: { sender_not_allowlisted: 0, sender_not_verified: 0 },
    moved: 0,
    labelled: 0,
    marked: 0,
    drafts: 0,
  }
}

function statusFor(outcome: Outcome, next: () => number): ActionStatus {
  if (outcome === "ok") return "completed"
  if (outcome === "error") return next() < 0.5 ? "partial" : "uncertain"
  return "failed"
}

function generate(now: number) {
  const next = random(20261120)
  const events: Event[] = []
  const actions = new Map<string, StoredAction>()
  let id = 0
  const end = Math.floor(now / HOUR) * HOUR
  for (let hour = end - 30 * DAY; hour <= end; hour += HOUR) {
    const local = (new Date(hour).getUTCHours() + 19) % 24
    const rate = local >= 8 && local <= 22 ? 3.2 : 0.35
    const calls = Math.floor(rate * (0.4 + next() * 1.4))
    for (let i = 0; i < calls; i++) {
      const time = hour + Math.floor(next() * HOUR)
      if (time > now) continue
      const tool = pick(next, TOOL_WEIGHTS)
      const outcome = pick<Outcome>(next, [
        ["ok", 94],
        ["refused", 3],
        ["error", 2],
        ["busy", 1],
      ])
      const counts = emptyCounts()
      const kind = KIND[tool]
      let duration = int(next, 120, 900)
      if (tool === "search_messages" || tool === "list_messages") {
        counts.requested = int(next, 5, 50)
        counts.returned = outcome === "ok" ? int(next, 0, counts.requested) : 0
        duration = int(next, 300, 4200)
      } else if (tool === "read_messages") {
        counts.requested = int(next, 1, 5)
        const notAllowed = next() < 0.18 ? int(next, 1, counts.requested) : 0
        const notVerified =
          notAllowed < counts.requested && next() < 0.05 ? 1 : 0
        counts.refused = {
          sender_not_allowlisted: notAllowed,
          sender_not_verified: notVerified,
        }
        counts.returned =
          outcome === "ok" ? counts.requested - notAllowed - notVerified : 0
        duration = int(next, 280, 1600)
      } else if (tool === "list_unsubscribe") {
        counts.requested = int(next, 1, 20)
        counts.returned = outcome === "ok" ? counts.requested : 0
      } else if (kind) {
        // Mostly small batches with the occasional larger cleanup, so messages
        // changed stay in proportion to write calls.
        counts.requested =
          kind === "draft" ? 1 : int(next, 1, next() < 0.85 ? 12 : 60)
        duration = int(next, 400, 5200)
      }
      if (outcome === "busy") duration = int(next, 2, 12)
      else if (outcome === "error" && next() < 0.4)
        duration = kind ? 120_000 : 45_000
      let actionId: string | null = null
      if (kind) {
        actionId = uuid(next)
        const status = statusFor(outcome, next)
        const done =
          status === "completed"
            ? counts.requested
            : status === "failed"
              ? 0
              : Math.floor(counts.requested / 2)
        const uncertain = status === "uncertain" ? counts.requested - done : 0
        const failed = counts.requested - done - uncertain
        if (kind === "draft") counts.drafts = done
        else if (kind === "label") counts.labelled = done
        else if (kind === "mark_read") counts.marked = done
        else counts.moved = done
        const chunks = Array.from(
          { length: Math.max(1, Math.ceil(counts.requested / CHUNK)) },
          (_, index) => {
            const size = Math.min(CHUNK, counts.requested - index * CHUNK)
            const start = index * CHUNK
            const chunkStatus: ActionStatus =
              start + size <= done
                ? "completed"
                : start < done
                  ? "partial"
                  : uncertain
                    ? "uncertain"
                    : "failed"
            return { index, size, status: chunkStatus }
          }
        )
        actions.set(actionId, {
          id: actionId,
          tool,
          kind,
          time: new Date(time).toISOString(),
          dry_run: false,
          status,
          counts: {
            requested: counts.requested,
            completed: done,
            uncertain,
            failed,
          },
          chunks,
          ...(kind === "archive"
            ? {
                unarchive:
                  status === "completed"
                    ? { eligible: true, reason: null, restored_by: null }
                    : {
                        eligible: false,
                        reason:
                          "Some chunks did not finish, so the archived set is not certain. Search Archive and move messages explicitly instead.",
                        restored_by: null,
                      },
              }
            : {}),
        })
      }
      events.push({
        id: id++,
        time: new Date(time).toISOString(),
        tool,
        outcome,
        duration_ms: duration + Math.round(next() * 10) / 10,
        login_ms:
          tool === "list_actions" || outcome === "busy"
            ? null
            : Math.round(40 + next() * 90),
        error_class:
          outcome === "ok"
            ? null
            : outcome === "refused"
              ? "PublicError"
              : outcome === "busy"
                ? "busy"
                : duration >= 45_000
                  ? "deadline"
                  : kind
                    ? "stopped"
                    : "OSError",
        action_id: actionId,
        counts,
      })
    }
  }
  events.sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
  // Mark one older completed archive as already restored.
  const archives = [...actions.values()].filter(
    (a) => a.kind === "archive" && a.status === "completed"
  )
  const unarchives = [...actions.values()].filter((a) => a.kind === "unarchive")
  if (archives.length > 3 && unarchives.length) {
    archives[2].unarchive = {
      eligible: false,
      reason: "This action was already restored to INBOX.",
      restored_by: unarchives[unarchives.length - 1].id,
    }
  }
  return { events, actions }
}

function latencySeries(
  now: number,
  next: () => number,
  base: number,
  failures: number[]
): LatencyPoint[] {
  const end = Math.floor(now / HOUR) * HOUR
  return Array.from({ length: 24 }, (_, i) => ({
    time: new Date(end - (23 - i) * HOUR).toISOString(),
    ms: failures.includes(i)
      ? null
      : Math.round(base * (0.8 + next() * 0.5) + (i % 7 === 3 ? base : 0)),
  }))
}

const SEED_ENTRIES: [string, string, number | null, number, number][] = [
  // address, note, expiry offset in days, added days ago, activity weight
  ["updates@example.org", "Shipping notices", null, 240, 0.9],
  ["receipts@example.net", "Order receipts", null, 182, 0.6],
  ["alerts@status.example.com", "Service status alerts", null, 96, 0.45],
  ["billing@example.org", "Invoices until the contract ends", 62, 26, 0.25],
  ["security@example.com", "Sign-in alerts", null, 19, 0.15],
  ["newsletter@example.net", "Weekly digest trial", -9, 40, 0.3],
  ["team@example.org", "Calendar invites", 6, 3, 0],
]

function seedAllowlist(now: number) {
  const next = random(7)
  const today = Math.floor(now / DAY) * DAY
  const history: (HistoryItem & { entry: string })[] = []
  const change = (entry: string, time: number, kind: string) =>
    history.push({ entry, time: new Date(time).toISOString(), change: kind })
  const entries = SEED_ENTRIES.map(
    ([address, note, expiry, addedDaysAgo, weight]) => {
      const id = uuid(next)
      const added = today - addedDaysAgo * DAY + 15 * HOUR
      const expires = expiry === null ? null : today + expiry * DAY - 1000
      const matches = Array.from({ length: MATCH_DAYS }, (_, i) => {
        const date = today - (MATCH_DAYS - 1 - i) * DAY
        const active =
          date >= added - DAY && (expires === null || date <= expires)
        return {
          date: new Date(date).toISOString().slice(0, 10),
          count:
            active && next() < weight ? int(next, 1, Math.ceil(weight * 4)) : 0,
        }
      })
      const lastDay = matches.findLastIndex((m) => m.count > 0)
      change(id, added, "added")
      if (weight > 0.8 || note.startsWith("Invoices"))
        change(id, added + 6 * DAY + 2 * HOUR, "note_changed")
      if (note.startsWith("Invoices"))
        change(id, added + 9 * DAY, "expiry_changed")
      if (expires !== null && expires < now) change(id, expires, "expired")
      const entry: AllowlistEntry = {
        id,
        address,
        note,
        added_at: new Date(added).toISOString(),
        expires_at: expires === null ? null : new Date(expires).toISOString(),
        last_matched_at:
          lastDay < 0
            ? null
            : new Date(
                today -
                  (MATCH_DAYS - 1 - lastDay) * DAY +
                  int(next, 8, 20) * HOUR
              ).toISOString(),
        match_count: matches.reduce((sum, m) => sum + m.count, 0),
        matches,
      }
      return entry
    }
  )
  const removed = uuid(next)
  change(removed, today - 21 * DAY + 10 * HOUR, "added")
  change(removed, today - 12 * DAY + 16 * HOUR, "removed")
  return { entries, history }
}

const json = (status: number, body: unknown): CoreResponse => ({
  status,
  body,
})
const notFound = (what: string) => json(404, { error: `${what} not found` })

export function createFixtures(now: () => number = () => Date.now()) {
  const started = now()
  const { events, actions } = generate(started)
  const allowlist = seedAllowlist(started)
  const previews = new Map<
    string,
    { action: string; expires: number; used: boolean }
  >()
  let counter = 1

  const sortedHistory = (entry?: string) =>
    allowlist.history
      .filter((h) => !entry || h.entry === entry)
      .toSorted((a, b) => Date.parse(b.time) - Date.parse(a.time))
      .slice(0, 50)
      .map(({ time, change }) => ({ time, change }))

  function overview(range: Range): Overview {
    const current = now()
    const bucket = range === "24h" ? HOUR : range === "7d" ? 6 * HOUR : DAY
    const count = range === "24h" ? 24 : range === "7d" ? 28 : 30
    const end = Math.floor(current / bucket) * bucket
    const first = end - (count - 1) * bucket
    const calls = Array.from({ length: count }, (_, i) => ({
      start: new Date(first + i * bucket).toISOString(),
      ok: 0,
      error: 0,
    }))
    const reads = calls.map(({ start }) => ({ start, allowed: 0, refused: 0 }))
    const writes = WRITE_KINDS.map((kind) => ({ kind, calls: 0, messages: 0 }))
    for (const event of events) {
      const index = Math.floor((Date.parse(event.time) - first) / bucket)
      if (index < 0 || index >= count) continue
      if (event.outcome === "ok") calls[index].ok++
      else calls[index].error++
      if (event.tool === "read_messages") {
        reads[index].allowed += event.counts.returned
        reads[index].refused +=
          event.counts.refused.sender_not_allowlisted +
          event.counts.refused.sender_not_verified
      }
      const kind = KIND[event.tool]
      if (kind) {
        const row = writes.find((w) => w.kind === kind)!
        row.calls++
        const c = event.counts
        row.messages += c.moved + c.labelled + c.marked + c.drafts
      }
    }
    const sum = <T>(rows: T[], key: (row: T) => number) =>
      rows.reduce((total, row) => total + key(row), 0)
    const bridge = health().components[0]
    return {
      range,
      generated_at: new Date(current).toISOString(),
      bucket_seconds: bucket / 1000,
      totals: {
        calls: sum(calls, (c) => c.ok + c.error),
        errors: sum(calls, (c) => c.error),
        body_reads_allowed: sum(reads, (r) => r.allowed),
        body_reads_refused: sum(reads, (r) => r.refused),
        writes: sum(writes, (w) => w.calls),
      },
      calls,
      body_reads: reads,
      writes_by_kind: writes,
      bridge: {
        state: bridge.state,
        checked_at: bridge.last_success_at,
        latency_ms: bridge.latency_ms,
        last_success_at: bridge.last_success_at,
        latency: bridge.latency,
      },
    }
  }

  function health(): Health {
    const current = now()
    const next = random(Math.floor(current / HOUR))
    const checked = new Date(current - 20_000).toISOString()
    const login = latencySeries(current, next, 78, [17])
    const mcp = latencySeries(current, next, 6, [])
    const stats = (points: LatencyPoint[]) => {
      const values = points
        .flatMap((p) => (p.ms === null ? [] : [p.ms]))
        .toSorted((a, b) => a - b)
      const at = (q: number) =>
        values.length
          ? values[Math.min(values.length - 1, Math.floor(q * values.length))]
          : null
      return { p50_ms: at(0.5), p95_ms: at(0.95) }
    }
    const quiet = {
      latency_ms: null,
      p50_ms: null,
      p95_ms: null,
      latency: [],
      errors_24h: 0,
      failures: [],
      last_success_at: checked,
      last_error_at: null,
      error_class: null,
    }
    return {
      checked_at: checked,
      state: "degraded",
      components: [
        {
          id: "bridge",
          name: "Bridge login",
          state: "degraded",
          latency_ms: login[23].ms,
          ...stats(login),
          latency: login,
          errors_24h: 3,
          failures: [
            { error_class: "TimeoutError", count: 2 },
            { error_class: "OSError", count: 1 },
          ],
          last_success_at: checked,
          last_error_at: login[17].time,
          error_class: "TimeoutError",
        },
        {
          id: "mcp",
          name: "MCP listener",
          state: "ok",
          latency_ms: mcp[23].ms,
          ...stats(mcp),
          latency: mcp,
          errors_24h: 0,
          failures: [],
          last_success_at: checked,
          last_error_at: null,
          error_class: null,
        },
        { id: "action_log", name: "Action log", state: "ok", ...quiet },
        { id: "allowlist", name: "Allowlist store", state: "ok", ...quiet },
      ],
    }
  }

  function unarchive(id: string, body: Record<string, unknown>) {
    const action = actions.get(id)
    if (!action) return notFound("Action")
    if (!action.unarchive)
      return json(409, { error: "Only archive actions can be unarchived" })
    if (!action.unarchive.eligible)
      return json(409, { error: action.unarchive.reason ?? "Not eligible" })
    if (body.dry_run === true) {
      const token = `pv_${(counter++).toString(36)}_${crypto.randomUUID()}`
      previews.set(token, {
        action: id,
        expires: now() + 5 * 60_000,
        used: false,
      })
      return json(200, {
        dry_run: true,
        preview_token: token,
        expires_at: new Date(now() + 5 * 60_000).toISOString(),
        messages: action.counts.completed,
        chunks: action.chunks.length,
      })
    }
    const preview = previews.get(String(body.preview_token))
    if (
      !preview ||
      preview.action !== id ||
      preview.used ||
      preview.expires < now()
    )
      return json(409, {
        error: "Preview expired. Preview the unarchive again.",
      })
    preview.used = true
    const restoredId = crypto.randomUUID()
    const counts = {
      requested: action.counts.completed,
      completed: action.counts.completed,
      uncertain: 0,
      failed: 0,
    }
    const time = new Date(now()).toISOString()
    actions.set(restoredId, {
      id: restoredId,
      tool: "unarchive_messages",
      kind: "unarchive",
      time,
      dry_run: false,
      status: "completed",
      counts,
      chunks: action.chunks.map((c) => ({ ...c, status: "completed" })),
    })
    action.unarchive = {
      eligible: false,
      reason: "This action was already restored to INBOX.",
      restored_by: restoredId,
    }
    events.unshift({
      id: events.length,
      time,
      tool: "unarchive_messages",
      outcome: "ok",
      duration_ms: 1840.2,
      login_ms: 64,
      error_class: null,
      action_id: restoredId,
      counts: {
        ...emptyCounts(),
        requested: counts.requested,
        moved: counts.completed,
      },
    })
    return json(200, {
      dry_run: false,
      action_id: restoredId,
      status: "completed",
      counts,
    })
  }

  function record(entry: string, change: string) {
    allowlist.history.push({
      entry,
      change,
      time: new Date(now()).toISOString(),
    })
  }

  const forward: Forward = async ({ method, path, body }: CoreRequest) => {
    const url = new URL(path, "http://core")
    const parts = url.pathname.split("/").filter(Boolean).slice(1)
    const input = (body ?? {}) as Record<string, unknown>
    if (method === "GET" && parts[0] === "overview")
      return json(
        200,
        overview((url.searchParams.get("range") || "7d") as Range)
      )
    if (method === "GET" && parts[0] === "health") return json(200, health())
    if (method === "GET" && parts[0] === "activity") {
      const tool = url.searchParams.get("tool")
      const outcome = url.searchParams.get("outcome")
      const rows = events.filter(
        (e) => (!tool || e.tool === tool) && (!outcome || e.outcome === outcome)
      )
      return json(200, {
        rows: rows.slice(0, 200).map(({ id: _id, ...row }) => {
          void _id
          return row
        }),
        truncated: rows.length > 200,
      })
    }
    if (parts[0] === "actions" && parts[1]) {
      if (method === "GET" && parts.length === 2) {
        const action = actions.get(parts[1])
        return action ? json(200, action) : notFound("Action")
      }
      if (method === "POST" && parts[2] === "unarchive")
        return unarchive(parts[1], input)
    }
    if (parts[0] === "allowlist") {
      const entries = allowlist.entries
      if (parts.length === 1 && method === "GET")
        return json(200, { entries, history: sortedHistory() })
      if (parts.length === 1 && method === "POST") {
        const address = String(input.address)
        if (entries.some((e) => e.address === address))
          return json(409, { error: `${address} is already allowed` })
        const today = Math.floor(now() / DAY) * DAY
        const entry: AllowlistEntry = {
          id: crypto.randomUUID(),
          address,
          note: String(input.note ?? ""),
          added_at: new Date(now()).toISOString(),
          expires_at: (input.expires_at as string | null) ?? null,
          last_matched_at: null,
          match_count: 0,
          matches: Array.from({ length: MATCH_DAYS }, (_, i) => ({
            date: new Date(today - (MATCH_DAYS - 1 - i) * DAY)
              .toISOString()
              .slice(0, 10),
            count: 0,
          })),
        }
        entries.push(entry)
        record(entry.id, "added")
        return json(201, { entry })
      }
      const entry = entries.find((e) => e.id === parts[1])
      if (!entry) return notFound("Entry")
      if (method === "GET")
        return json(200, { entry, history: sortedHistory(entry.id) })
      if (method === "PATCH") {
        if (
          typeof input.address === "string" &&
          input.address !== entry.address
        ) {
          if (entries.some((e) => e.address === input.address))
            return json(409, { error: `${input.address} is already allowed` })
          entry.address = input.address
          record(entry.id, "address_changed")
        }
        if (typeof input.note === "string" && input.note !== entry.note) {
          entry.note = input.note
          record(entry.id, "note_changed")
        }
        if ("expires_at" in input && input.expires_at !== entry.expires_at) {
          entry.expires_at = input.expires_at as string | null
          record(entry.id, "expiry_changed")
        }
        return json(200, { entry })
      }
      if (method === "DELETE") {
        entries.splice(entries.indexOf(entry), 1)
        record(entry.id, "removed")
        return json(200, {})
      }
    }
    return json(404, { error: "Not found" })
  }

  return { forward }
}
