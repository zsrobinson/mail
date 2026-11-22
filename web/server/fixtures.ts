/**
 * Synthetic development data. Nothing here is derived from a mailbox: every
 * address is on example.org, example.net or example.com, and every count is
 * generated from a fixed seed relative to the current time.
 */
import type {
  Action,
  ActionStatus,
  Activity,
  ActivityRow,
  AllowlistEntry,
  AttentionItem,
  Enforcement,
  EntryState,
  Health,
  HistoryItem,
  Incident,
  LatencyPoint,
  Outcome,
  Overview,
  PeriodTotals,
  Range,
  State,
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

const hex = (next: () => number, length: number) =>
  Array.from({ length }, () => Math.floor(next() * 16).toString(16)).join("")

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

type Event = ActivityRow
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
  const end = Math.floor(now / HOUR) * HOUR
  for (let hour = end - 30 * DAY; hour <= end; hour += HOUR) {
    const local = (new Date(hour).getUTCHours() + 19) % 24
    const rate = local >= 8 && local <= 22 ? 3.2 : 0.35
    const calls = Math.floor(rate * (0.4 + next() * 1.4))
    for (let i = 0; i < calls; i++) {
      const time = hour + Math.floor(next() * HOUR)
      if (time > now) continue
      const tool = pick(next, TOOL_WEIGHTS)
      let outcome = pick<Outcome>(next, [
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
      // As in the core: "refused" means bodies were withheld by the
      // allowlist; any other refusal is an error with class PublicError.
      const withheld =
        counts.refused.sender_not_allowlisted +
        counts.refused.sender_not_verified
      if (withheld > 0 && outcome === "ok") outcome = "refused"
      let publicError = false
      if (outcome === "refused" && withheld === 0) {
        outcome = "error"
        publicError = true
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
        id: hex(next, 32),
        time: new Date(time).toISOString(),
        tool,
        outcome,
        duration_ms: duration + Math.round(next() * 10) / 10,
        login_ms:
          tool === "list_actions" || outcome === "busy"
            ? null
            : Math.round(40 + next() * 90),
        error_class:
          outcome === "ok" || outcome === "refused"
            ? null
            : outcome === "busy"
              ? "busy"
              : publicError
                ? "PublicError"
                : duration >= 45_000
                  ? "deadline"
                  : kind
                    ? "stopped"
                    : "OSError",
        action_id: actionId,
        connected: outcome !== "busy",
        dry_run: false,
        source_action_id: null,
        chunks: actionId ? actions.get(actionId)!.chunks : [],
        counts,
      })
      if (actionId) actions.get(actionId)!.call_id = events.at(-1)!.id
    }
  }
  events.sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
  // Mark one older completed archive as already restored.
  const archives = [...actions.values()].filter(
    (a) => a.kind === "archive" && a.status === "completed"
  )
  const unarchives = [...actions.values()].filter((a) => a.kind === "unarchive")
  if (archives.length > 3 && unarchives.length) {
    const restore = unarchives[unarchives.length - 1]
    archives[2].unarchive = {
      eligible: false,
      reason: "This action was already restored to INBOX.",
      restored_by: restore.id,
    }
    restore.source_action_id = archives[2].id
    const event = events.find((e) => e.action_id === restore.id)
    if (event) event.source_action_id = archives[2].id
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
  ["newsletter@example.net", "Weekly digest trial", -3, 40, 0.3],
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
                Math.min(
                  now - 20 * 60_000,
                  today -
                    (MATCH_DAYS - 1 - lastDay) * DAY +
                    int(next, 8, 20) * HOUR
                )
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

type Unit = "hour" | "6h" | "day" | "week"
const UNIT_MS: Record<Unit, number> = {
  hour: HOUR,
  "6h": 6 * HOUR,
  day: DAY,
  week: 7 * DAY,
}

/** Offset of a zone from UTC at an instant, in milliseconds. */
function zoneOffset(time: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(time)
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  const local = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  )
  return local - Math.floor(time / 1000) * 1000
}

/** Start of the calendar bucket holding `time`, in the caller's zone. */
function floorLocal(time: number, unit: Unit, tz: string) {
  const offset = zoneOffset(time, tz)
  const local = new Date(time + offset)
  if (unit === "hour") local.setUTCMinutes(0, 0, 0)
  else if (unit === "6h")
    local.setUTCHours(local.getUTCHours() - (local.getUTCHours() % 6), 0, 0, 0)
  else {
    local.setUTCHours(0, 0, 0, 0)
    if (unit === "week")
      local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7))
  }
  const guess = local.getTime() - offset
  return local.getTime() - zoneOffset(guess, tz)
}

function bucketStarts(first: number, last: number, unit: Unit, tz: string) {
  const starts: number[] = []
  let current = floorLocal(first, unit, tz)
  while (current <= last && starts.length < 1000) {
    starts.push(current)
    const bump = unit === "day" || unit === "week" ? 2 * HOUR : 60_000
    current = floorLocal(current + UNIT_MS[unit] + bump, unit, tz)
  }
  return starts
}

const RANGE_SPEC: Record<Range, [number, Unit]> = {
  "24h": [1, "hour"],
  "7d": [7, "6h"],
  "30d": [30, "day"],
}

function rangeStarts(range: Range, current: number, tz: string) {
  const [days, unit] = RANGE_SPEC[range]
  const starts = bucketStarts(current - days * DAY, current, unit, tz)
  return { starts: starts.slice(-((days * DAY) / UNIT_MS[unit])), unit }
}

const SEARCH_WORDS: Record<string, string> = {
  list_folders: "list folders",
  list_messages: "list messages",
  search_messages: "search messages",
  list_unsubscribe: "unsubscribe headers",
  read_messages: "read bodies body reads",
  create_draft: "create draft",
  archive_messages: "archive",
  unarchive_messages: "unarchive restore",
  move_messages: "move",
  add_labels: "add labels label",
  mark_read: "mark read",
  list_actions: "action history",
  sender_not_allowlisted: "not on allowlist not allowlisted refused",
  sender_not_verified: "sender not verified unverified refused",
  deadline: "deadline timed out timeout",
  stopped: "stopped partial",
  PublicError: "refused rejected",
  TimeoutError: "timeout timed out",
  OSError: "connection network",
  busy: "busy",
}

const refusedCount = (e: ActivityRow) =>
  e.counts.refused.sender_not_allowlisted + e.counts.refused.sender_not_verified
const changedCount = (e: ActivityRow) =>
  e.counts.moved + e.counts.labelled + e.counts.marked + e.counts.drafts

function searchText(e: ActivityRow) {
  return [
    e.tool,
    SEARCH_WORDS[e.tool] ?? "",
    e.outcome,
    e.error_class ?? "",
    SEARCH_WORDS[e.error_class ?? ""] ?? "",
    e.action_id ?? "",
    e.source_action_id ?? "",
    e.id,
    ...Object.entries(e.counts.refused)
      .filter(([, count]) => count > 0)
      .map(([code]) => `${code} ${SEARCH_WORDS[code]}`),
  ]
    .join(" ")
    .toLowerCase()
}

function totalsOf(rows: ActivityRow[]): PeriodTotals {
  const reads = rows.filter((r) => r.tool === "read_messages")
  const writes = rows.filter((r) => KIND[r.tool] && !r.dry_run)
  const sum = <T>(items: T[], f: (item: T) => number) =>
    items.reduce((total, item) => total + f(item), 0)
  return {
    calls: rows.length,
    errors: rows.filter((r) => r.outcome !== "ok").length,
    body_reads_allowed: sum(reads, (r) => r.counts.returned),
    body_reads_refused: sum(reads, refusedCount),
    writes: writes.length,
    messages_changed: sum(writes, changedCount),
    refusals: {
      sender_not_allowlisted: sum(
        reads,
        (r) => r.counts.refused.sender_not_allowlisted
      ),
      sender_not_verified: sum(
        reads,
        (r) => r.counts.refused.sender_not_verified
      ),
    },
  }
}

const RELEASE = {
  tag: "v0.4.2",
  commit: "0123456789abcdef0123456789abcdef01234567",
}

export function createFixtures(now: () => number = () => Date.now()) {
  const started = now()
  const { events, actions } = generate(started)
  const allowlist = seedAllowlist(started)
  const removed = new Map<string, AllowlistEntry>()
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

  const entryState = (entry: AllowlistEntry, current: number): EntryState => {
    if (!entry.expires_at) return "active"
    const expires = Date.parse(entry.expires_at)
    return expires <= current
      ? "expired"
      : expires - current <= 7 * DAY
        ? "expiring"
        : "active"
  }

  function enforcement(): Enforcement {
    return {
      authserv_configured: true,
      store_ok: true,
      audit: {
        time: new Date(started - 2 * DAY - 3 * HOUR).toISOString(),
        counts: {
          scanned: 1000,
          candidates: 4210,
          allowlisted_sender: 64,
          authenticated_allowlisted: 61,
          unverified_allowlisted: 3,
          with_authentication_results: 998,
          with_trusted_topmost: 996,
        },
      },
    }
  }

  function overview(range: Range, tz: string): Overview {
    const current = now()
    const { starts, unit } = rangeStarts(range, current, tz)
    const first = starts[0]
    const length = current - first
    const index = new Map(starts.map((s, i) => [s, i]))
    const calls = starts.map((s) => ({
      start: new Date(s).toISOString(),
      ok: 0,
      error: 0,
    }))
    const reads = calls.map(({ start }) => ({ start, allowed: 0, refused: 0 }))
    const writes = WRITE_KINDS.map((kind) => ({ kind, calls: 0, messages: 0 }))
    const inRange = events.filter((e) => Date.parse(e.time) >= first)
    const before = events.filter(
      (e) => Date.parse(e.time) >= first - length && Date.parse(e.time) < first
    )
    for (const event of inRange) {
      const i = index.get(floorLocal(Date.parse(event.time), unit, tz))
      if (i === undefined) continue
      if (event.outcome === "ok") calls[i].ok++
      else calls[i].error++
      if (event.tool === "read_messages") {
        reads[i].allowed += event.counts.returned
        reads[i].refused += refusedCount(event)
      }
      const kind = KIND[event.tool]
      if (kind) {
        const row = writes.find((w) => w.kind === kind)!
        row.calls++
        row.messages += changedCount(event)
      }
    }
    const totals = totalsOf(inRange)
    const previous = totalsOf(before)
    const bridge = health("24h", tz).components[0]
    const since = new Date(first).toISOString().slice(0, 10)
    const top = allowlist.entries
      .map((entry) => ({
        id: entry.id,
        address: entry.address,
        matches: entry.matches
          .filter((m) => m.date >= since)
          .reduce((sum, m) => sum + m.count, 0),
        state: entryState(entry, current),
      }))
      .filter((e) => e.matches > 0)
      .toSorted(
        (a, b) => b.matches - a.matches || a.address.localeCompare(b.address)
      )
      .slice(0, 5)
    const attention: AttentionItem[] = []
    if (bridge.state === "down" || bridge.state === "degraded")
      attention.push({
        kind: "bridge",
        severity: bridge.state === "down" ? "critical" : "warning",
        state: bridge.state,
        time: bridge.last_error_at,
      })
    const refusedNow =
      totals.refusals.sender_not_allowlisted +
      totals.refusals.sender_not_verified
    const refusedBefore =
      previous.refusals.sender_not_allowlisted +
      previous.refusals.sender_not_verified
    if (refusedNow >= 5 && refusedNow >= 2 * Math.max(1, refusedBefore))
      attention.push({
        kind: "refusal_spike",
        severity: "warning",
        count: refusedNow,
        previous: refusedBefore,
      })
    for (const entry of allowlist.entries.toSorted((a, b) =>
      (a.expires_at ?? "").localeCompare(b.expires_at ?? "")
    )) {
      const state = entryState(entry, current)
      if (
        state === "expiring" ||
        (state === "expired" &&
          current - Date.parse(entry.expires_at!) <= 7 * DAY)
      )
        attention.push({
          kind: state,
          severity: state === "expiring" ? "warning" : "info",
          entry_id: entry.id,
          address: entry.address,
          time: entry.expires_at,
        })
    }
    return {
      range,
      generated_at: new Date(current).toISOString(),
      bucket_seconds: UNIT_MS[unit] / 1000,
      period: {
        start: new Date(first).toISOString(),
        end: new Date(current).toISOString(),
        previous_start: new Date(first - length).toISOString(),
      },
      totals,
      previous,
      calls,
      body_reads: reads,
      writes_by_kind: writes,
      top_senders: top,
      attention,
      bridge: {
        state: bridge.state,
        checked_at: bridge.last_success_at,
        latency_ms: bridge.latency_ms,
        last_success_at: bridge.last_success_at,
        latency: bridge.latency,
      },
    }
  }

  function activity(params: URLSearchParams): Activity {
    const current = now()
    const words = (params.get("q") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    const from = params.get("from") ? Date.parse(params.get("from")!) : null
    const to = params.get("to") ? Date.parse(params.get("to")!) : null
    const tools = (params.get("tool") ?? "").split(",").filter(Boolean)
    const outcomes = (params.get("outcome") ?? "").split(",").filter(Boolean)
    const refusalsOnly = params.get("refusals") === "1"
    const offset = Number(params.get("offset") ?? 0)
    const limit = Number(params.get("limit") ?? 50)
    const tz = params.get("tz") || "UTC"
    const rows = events.filter((e) => {
      const time = Date.parse(e.time)
      if (from !== null && time < from) return false
      if (to !== null && time >= to) return false
      if (tools.length && !tools.includes(e.tool)) return false
      if (outcomes.length && !outcomes.includes(e.outcome)) return false
      if (refusalsOnly && refusedCount(e) === 0) return false
      if (words.length) {
        const text = searchText(e)
        if (!words.every((w) => text.includes(w))) return false
      }
      return true
    })
    const spanStart =
      from ?? (rows.length ? Date.parse(rows.at(-1)!.time) : current - 7 * DAY)
    const spanEnd = to !== null ? Math.min(to, current) : current
    const span = spanEnd - spanStart
    const unit: Unit =
      span <= 2 * DAY ? "hour" : span <= 92 * DAY ? "day" : "week"
    const starts = bucketStarts(spanStart, spanEnd, unit, tz)
    const index = new Map(starts.map((s, i) => [s, i]))
    const points = starts.map((s) => ({
      start: new Date(s).toISOString(),
      ok: 0,
      refused: 0,
      error: 0,
    }))
    for (const row of rows) {
      const i = index.get(floorLocal(Date.parse(row.time), unit, tz))
      if (i === undefined) continue
      if (row.outcome === "ok" || row.outcome === "busy") points[i].ok++
      else if (row.outcome === "refused") points[i].refused++
      else points[i].error++
    }
    const page = rows.slice(offset, offset + limit)
    return {
      rows: page,
      total: rows.length,
      offset,
      limit,
      truncated: offset + page.length < rows.length,
      series: { bucket_seconds: UNIT_MS[unit] / 1000, points },
    }
  }

  function health(range: Range, tz: string): Health {
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
    const { starts, unit } = rangeStarts(range, current, tz)
    // Synthetic history: Bridge hiccups at fixed offsets, one tool-call
    // deadline, and nothing recorded before the fixtures "started" 26 days ago.
    const bridgeFailures = [
      current - 6 * HOUR - 20 * 60_000,
      current - 6 * HOUR - 12 * 60_000,
      current - 3 * DAY - 2 * HOUR,
      current - 12 * DAY,
    ]
    const toolErrors = events
      .filter((e) => e.outcome === "error")
      .map((e) => ({
        time: Date.parse(e.time),
        error: e.error_class ?? "internal",
      }))
    const timeline = (id: string) =>
      starts.map((start) => {
        const end = start + UNIT_MS[unit]
        const recorded = start >= current - 26 * DAY
        const failed =
          id === "bridge"
            ? bridgeFailures.filter((t) => t >= start && t < end).length
            : id === "mcp"
              ? toolErrors.filter((t) => t.time >= start && t.time < end).length
              : 0
        const ok = recorded ? Math.round((end - start) / 60_000) - failed : 0
        const state: State = !recorded
          ? "unknown"
          : failed === 0
            ? "ok"
            : ok === 0
              ? "down"
              : "degraded"
        return { start: new Date(start).toISOString(), state, ok, failed }
      })
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
    const since = starts[0]
    const incidents: Incident[] = [
      ...bridgeFailures.slice(0, 1).map((t) => ({
        component: "bridge",
        error_class: "TimeoutError",
        count: 2,
        started_at: new Date(t).toISOString(),
        ended_at: new Date(bridgeFailures[1]).toISOString(),
      })),
      ...bridgeFailures.slice(2).map((t, i) => ({
        component: "bridge",
        error_class: i ? "OSError" : "TimeoutError",
        count: 1,
        started_at: new Date(t).toISOString(),
        ended_at: new Date(t).toISOString(),
      })),
      ...toolErrors.slice(0, 12).map((t) => ({
        component: "mcp",
        error_class: t.error,
        count: 1,
        started_at: new Date(t.time).toISOString(),
        ended_at: new Date(t.time).toISOString(),
      })),
    ]
      .filter((i) => Date.parse(i.ended_at) >= since)
      .toSorted((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))
    const mcpErrors = toolErrors.filter((t) => t.time >= current - DAY)
    return {
      checked_at: checked,
      state: "degraded",
      range,
      bucket_seconds: UNIT_MS[unit] / 1000,
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
          timeline: timeline("bridge"),
        },
        {
          id: "mcp",
          name: "MCP listener",
          state: "ok",
          latency_ms: mcp[23].ms,
          ...stats(mcp),
          latency: mcp,
          errors_24h: mcpErrors.length,
          failures: mcpErrors.length
            ? [{ error_class: mcpErrors[0].error, count: mcpErrors.length }]
            : [],
          last_success_at: checked,
          last_error_at: mcpErrors.length
            ? new Date(mcpErrors[0].time).toISOString()
            : null,
          error_class: mcpErrors[0]?.error ?? null,
          timeline: timeline("mcp"),
        },
        {
          id: "action_log",
          name: "Action log",
          state: "ok",
          ...quiet,
          timeline: timeline("action_log"),
        },
        {
          id: "allowlist",
          name: "Allowlist store",
          state: "ok",
          ...quiet,
          timeline: timeline("allowlist"),
        },
      ],
      incidents,
      enforcement: enforcement(),
      about: { version: "0.4.2", release: RELEASE },
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
    const callId = crypto.randomUUID().replaceAll("-", "")
    const counts = {
      requested: action.counts.completed,
      completed: action.counts.completed,
      uncertain: 0,
      failed: 0,
    }
    const time = new Date(now()).toISOString()
    const chunks = action.chunks.map((c) => ({
      ...c,
      status: "completed" as const,
    }))
    actions.set(restoredId, {
      id: restoredId,
      tool: "unarchive_messages",
      kind: "unarchive",
      time,
      dry_run: false,
      status: "completed",
      counts,
      chunks,
      call_id: callId,
      source_action_id: id,
    })
    action.unarchive = {
      eligible: false,
      reason: "This action was already restored to INBOX.",
      restored_by: restoredId,
    }
    events.unshift({
      id: callId,
      time,
      tool: "unarchive_messages",
      outcome: "ok",
      duration_ms: 1840.2,
      login_ms: 64,
      connected: true,
      error_class: null,
      action_id: restoredId,
      dry_run: false,
      source_action_id: id,
      chunks,
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
    const range = (url.searchParams.get("range") || "") as Range
    const tz = url.searchParams.get("tz") || "UTC"
    if (method === "GET" && parts[0] === "overview")
      return json(200, overview(range || "7d", tz))
    if (method === "GET" && parts[0] === "health")
      return json(200, health(range || "24h", tz))
    if (method === "GET" && parts[0] === "activity" && parts.length === 1)
      return json(200, activity(url.searchParams))
    if (method === "GET" && parts[0] === "activity" && parts.length === 2) {
      const call = events.find((e) => e.id === parts[1])
      if (!call) return notFound("Call")
      const action = call.action_id ? actions.get(call.action_id) : undefined
      return json(200, { call, action: action ?? null })
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
          return json(409, {
            error: "That address is already on the allowlist",
          })
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
      if (parts.length === 3 && parts[2] === "restore" && method === "POST") {
        const entry = removed.get(parts[1])
        if (!entry) return notFound("Entry")
        if (entries.some((e) => e.address === entry.address))
          return json(409, {
            error: "That address is already on the allowlist",
          })
        removed.delete(entry.id)
        entries.push(entry)
        record(entry.id, "added")
        return json(200, { entry })
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
            return json(409, {
              error: "That address is already on the allowlist",
            })
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
        removed.set(entry.id, entry)
        record(entry.id, "removed")
        return json(200, {})
      }
    }
    return json(404, { error: "Not found" })
  }

  return { forward }
}
