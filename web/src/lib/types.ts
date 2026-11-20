/** JSON shapes served by the private core API. See API.md. */

export const RANGES = ["24h", "7d", "30d"] as const
export type Range = (typeof RANGES)[number]

export const TOOLS = [
  "list_folders",
  "list_messages",
  "search_messages",
  "list_unsubscribe",
  "read_messages",
  "create_draft",
  "archive_messages",
  "unarchive_messages",
  "move_messages",
  "add_labels",
  "mark_read",
  "list_actions",
] as const
export type Tool = (typeof TOOLS)[number] | "unknown"

export const OUTCOMES = ["ok", "refused", "error", "busy"] as const
export type Outcome = (typeof OUTCOMES)[number]

export const WRITE_KINDS = [
  "archive",
  "unarchive",
  "move",
  "label",
  "mark_read",
  "draft",
] as const
export type WriteKind = (typeof WRITE_KINDS)[number]

export type State = "ok" | "degraded" | "down" | "unknown"

export type LatencyPoint = { time: string; ms: number | null }

export type Overview = {
  range: Range
  generated_at: string
  bucket_seconds: number
  totals: {
    calls: number
    errors: number
    body_reads_allowed: number
    body_reads_refused: number
    writes: number
  }
  calls: { start: string; ok: number; error: number }[]
  body_reads: { start: string; allowed: number; refused: number }[]
  writes_by_kind: { kind: WriteKind; calls: number; messages: number }[]
  bridge: {
    state: State
    checked_at: string | null
    latency_ms: number | null
    last_success_at: string | null
    latency: LatencyPoint[]
  }
}

export type ActivityCounts = {
  requested: number
  returned: number
  refused: { sender_not_allowlisted: number; sender_not_verified: number }
  moved: number
  labelled: number
  marked: number
  drafts: number
}

export type ActivityRow = {
  time: string
  tool: Tool
  outcome: Outcome
  duration_ms: number
  login_ms: number | null
  error_class: string | null
  action_id: string | null
  counts: ActivityCounts
}

export type Activity = { rows: ActivityRow[]; truncated: boolean }

export type ActionStatus =
  "completed" | "partial" | "uncertain" | "failed" | "dry_run"

export type ActionCounts = {
  requested: number
  completed: number
  uncertain: number
  failed: number
}

export type Action = {
  id: string
  tool: Tool
  kind: WriteKind
  time: string
  dry_run: boolean
  status: ActionStatus
  counts: ActionCounts
  chunks: { index: number; size: number; status: ActionStatus }[]
  unarchive?: {
    eligible: boolean
    reason: string | null
    restored_by: string | null
  }
}

export type UnarchivePreview = {
  dry_run: true
  preview_token: string
  expires_at: string
  messages: number
  chunks: number
}

export type UnarchiveResult = {
  dry_run: false
  action_id: string
  status: ActionStatus
  counts: ActionCounts
}

export type AllowlistEntry = {
  id: string
  address: string
  note: string
  added_at: string
  expires_at: string | null
  last_matched_at: string | null
  match_count: number
  matches: { date: string; count: number }[]
}

export type AllowlistChange =
  | "added"
  | "address_changed"
  | "note_changed"
  | "expiry_changed"
  | "expired"
  | "removed"

export type HistoryItem = {
  time: string
  change: AllowlistChange | (string & {})
}

export type Allowlist = { entries: AllowlistEntry[]; history: HistoryItem[] }
export type AllowlistDetail = { entry: AllowlistEntry; history: HistoryItem[] }

export type AllowlistInput = {
  address: string
  note: string
  expires_at: string | null
}

export type HealthComponent = {
  id: string
  name: string
  state: State
  /** Most recent sample, then the 24-hour median and 95th percentile. */
  latency_ms: number | null
  p50_ms: number | null
  p95_ms: number | null
  latency: LatencyPoint[]
  errors_24h: number
  failures: { error_class: string; count: number }[]
  last_success_at: string | null
  last_error_at: string | null
  error_class: string | null
}

export type Health = {
  checked_at: string
  state: State
  components: HealthComponent[]
}

export type Session = { email: string; services: unknown[] }
