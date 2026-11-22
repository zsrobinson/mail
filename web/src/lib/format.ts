import type {
  ActionStatus,
  ActivityCounts,
  EntryState,
  Outcome,
  RefusalReason,
  State,
  Tool,
  WriteKind,
} from "./types"

export const TOOL_LABELS: Record<Tool, string> = {
  list_folders: "List folders",
  list_messages: "List messages",
  search_messages: "Search messages",
  list_unsubscribe: "Unsubscribe headers",
  read_messages: "Read bodies",
  create_draft: "Create draft",
  archive_messages: "Archive",
  unarchive_messages: "Unarchive",
  move_messages: "Move",
  add_labels: "Add labels",
  mark_read: "Mark read",
  list_actions: "Action history",
  unknown: "Unknown tool",
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  ok: "Succeeded",
  refused: "Refused",
  error: "Failed",
  busy: "Busy",
}

export const KIND_LABELS: Record<WriteKind, string> = {
  archive: "Archive",
  unarchive: "Unarchive",
  move: "Move",
  label: "Label",
  mark_read: "Mark read",
  draft: "Draft",
}

export const STATE_LABELS: Record<State, string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
}

export const STATUS_LABELS: Record<ActionStatus, string> = {
  completed: "Completed",
  partial: "Partial",
  uncertain: "Uncertain",
  failed: "Failed",
  dry_run: "Dry run",
}

export const CHANGE_LABELS: Record<string, string> = {
  added: "Added",
  address_changed: "Address changed",
  note_changed: "Note changed",
  expiry_changed: "Expiry changed",
  expired: "Expired",
  removed: "Removed",
}

export function formatMs(ms: number | null | undefined) {
  if (ms == null) return "—"
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

export const formatInteger = (value: number) =>
  new Intl.NumberFormat().format(value)

const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
export function formatDate(iso: string) {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? "—" : dateOnly.format(time)
}

export const REFUSAL_LABELS: Record<RefusalReason, string> = {
  sender_not_allowlisted: "Not on allowlist",
  sender_not_verified: "Sender not verified",
}

export const REFUSAL_DESCRIPTIONS: Record<RefusalReason, string> = {
  sender_not_allowlisted:
    "The sender is not an active allowlist entry, so the body was withheld.",
  sender_not_verified:
    "The sender is allowed, but the receiving server did not confirm DMARC or aligned DKIM, so the body was withheld.",
}

type ErrorInfo = { label: string; description: string }

/** Fixed error classes from the core, in words. Unknown classes show as-is. */
export const ERROR_INFO: Record<string, ErrorInfo> = {
  deadline: {
    label: "Timed out",
    description:
      "The call reached its deadline (45 s for searches, 120 s for writes) before it finished.",
  },
  stopped: {
    label: "Stopped part-way",
    description:
      "A write stopped after a failed or uncertain chunk; later chunks were not attempted.",
  },
  PublicError: {
    label: "Refused by the server",
    description:
      "The server refused the request, for example for invalid arguments or a safety check.",
  },
  TimeoutError: {
    label: "Network timeout",
    description: "Bridge did not answer in time.",
  },
  OSError: {
    label: "Connection error",
    description: "Bridge could not be reached, or the connection dropped.",
  },
  ValueError: {
    label: "Invalid value",
    description: "A value from the request or from Bridge was not valid.",
  },
  RuntimeError: {
    label: "Runtime error",
    description: "The server hit an unexpected state while handling the call.",
  },
  internal: {
    label: "Internal error",
    description: "An unexpected error; the server logged its class only.",
  },
  busy: {
    label: "Busy",
    description:
      "Another mail operation was running, so this call was turned away without touching mail.",
  },
  unavailable: {
    label: "Unavailable",
    description: "The check failed: the file or service was not usable.",
  },
}

export function errorLabel(errorClass: string) {
  return ERROR_INFO[errorClass]?.label ?? errorClass
}

export const COMPONENT_LABELS: Record<string, string> = {
  bridge: "Bridge login",
  mcp: "MCP server",
  action_log: "Action log",
  allowlist: "Allowlist store",
}

const dayHeading = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
})
const dayHeadingYear = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
})

/** Local calendar day of an ISO instant, as YYYY-MM-DD. */
export function localDay(iso: string) {
  const d = new Date(Date.parse(iso))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** "Today", "Yesterday" or "Saturday, Nov 21". */
export function formatDayHeading(day: string, now = new Date()) {
  const [y, m, d] = day.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  return (y === now.getFullYear() ? dayHeading : dayHeadingYear).format(date)
}

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})
export const formatClock = (iso: string) => clock.format(Date.parse(iso))

const precise = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
})
export const formatPrecise = (iso: string) => precise.format(Date.parse(iso))

/** Short id for display; the page or tooltip carries the full one. */
export const shortId = (id: string) => id.replaceAll("-", "").slice(0, 8)

const WRITE_VERBS: Partial<Record<Tool, [string, keyof ActivityCounts]>> = {
  archive_messages: ["archived", "moved"],
  unarchive_messages: ["restored", "moved"],
  move_messages: ["moved", "moved"],
  add_labels: ["labelled", "labelled"],
  mark_read: ["marked read", "marked"],
  create_draft: ["saved", "drafts"],
}

/** What a call did, in a short phrase: "2 of 3 bodies returned". */
export function callSummary(row: {
  tool: Tool
  dry_run?: boolean
  counts: ActivityCounts
}): string {
  const c = row.counts
  const refused =
    c.refused.sender_not_allowlisted + c.refused.sender_not_verified
  const n = (value: number) => formatInteger(value)
  const verb = WRITE_VERBS[row.tool]
  if (verb) {
    const done = c[verb[1]] as number
    if (row.tool === "create_draft")
      return row.dry_run
        ? "Draft preview"
        : done
          ? "Draft saved"
          : "No draft saved"
    if (row.dry_run)
      return `Preview of ${n(c.requested)} ${plural(c.requested, "message")}`
    return `${n(done)} of ${n(c.requested)} ${plural(c.requested, "message")} ${verb[0]}`
  }
  if (row.tool === "read_messages")
    return refused
      ? `${n(c.returned)} of ${n(c.requested)} ${plural(c.requested, "body", "bodies")} returned`
      : `${n(c.returned)} ${plural(c.returned, "body", "bodies")} returned`
  if (row.tool === "list_unsubscribe")
    return `${n(c.returned)} unsubscribe ${plural(c.returned, "header")}`
  if (row.tool === "search_messages" || row.tool === "list_messages")
    return `${n(c.returned)} ${plural(c.returned, "result")}${c.requested ? ` (limit ${n(c.requested)})` : ""}`
  return ""
}

function plural(count: number, one: string, many = `${one}s`) {
  return count === 1 ? one : many
}

export function refusalTotal(counts: ActivityCounts) {
  return (
    counts.refused.sender_not_allowlisted + counts.refused.sender_not_verified
  )
}

const EXPIRY_NOTICE_MS = 7 * 86_400_000

/** Active, expiring within a week, or expired, as of `now`. */
export function entryState(
  expiresAt: string | null,
  now = Date.now()
): EntryState {
  if (!expiresAt) return "active"
  const expires = Date.parse(expiresAt)
  if (expires <= now) return "expired"
  return expires - now <= EXPIRY_NOTICE_MS ? "expiring" : "active"
}

/** Tick and tooltip labels for a series bucket of the given size. */
export function bucketFormat(bucketSeconds: number) {
  const options: Intl.DateTimeFormatOptions =
    bucketSeconds >= 604_800
      ? { month: "short", day: "numeric" }
      : bucketSeconds >= 86_400
        ? { weekday: "short", month: "short", day: "numeric" }
        : { weekday: "short", hour: "numeric" }
  const formatter = new Intl.DateTimeFormat(undefined, options)
  return (time: number) =>
    bucketSeconds >= 604_800
      ? `Week of ${formatter.format(time)}`
      : formatter.format(time)
}

/** One vocabulary and colour per outcome for every calls chart. */
export const OUTCOME_SERIES = {
  ok: { label: "Succeeded", color: "var(--chart-1)" },
  refused: { label: "Refused", color: "var(--chart-3)" },
  error: { label: "Failed", color: "var(--destructive)" },
}

const expiryDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
const expiryDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

/**
 * An expiry as the viewer reads it: just the date when it ends at the close of
 * that day (11:59 PM local, as the form sets it), otherwise date and time.
 */
export function formatExpiry(iso: string) {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return "—"
  const date = new Date(time)
  return date.getHours() === 23 && date.getMinutes() === 59
    ? expiryDate.format(date)
    : expiryDateTime.format(date)
}
