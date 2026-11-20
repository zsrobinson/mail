import type {
  ActionStatus,
  ActivityCounts,
  Outcome,
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
  ok: "Ok",
  refused: "Refused",
  error: "Error",
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
  ok: "Ok",
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

/** Non-zero counts in a fixed order, for compact table cells. */
export function countParts(counts: ActivityCounts): [string, number][] {
  const refused =
    counts.refused.sender_not_allowlisted + counts.refused.sender_not_verified
  const parts: [string, number][] = [
    ["requested", counts.requested],
    ["returned", counts.returned],
    ["refused", refused],
    ["moved", counts.moved],
    ["labelled", counts.labelled],
    ["marked", counts.marked],
    ["drafted", counts.drafts],
  ]
  return parts.filter(([, value]) => value > 0)
}

/** Epoch seconds for shell charts. */
export const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000)

export function isExpired(expiresAt: string | null, now = Date.now()) {
  return expiresAt !== null && Date.parse(expiresAt) <= now
}

const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
export function formatDate(iso: string) {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? "—" : dateOnly.format(time)
}
