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

export const REFUSAL_REASONS = [
  "sender_not_allowlisted",
  "sender_not_verified",
] as const
export type RefusalReason = (typeof REFUSAL_REASONS)[number]

export type PeriodTotals = {
  calls: number
  errors: number
  body_reads_allowed: number
  body_reads_refused: number
  writes: number
  messages_changed: number
  refusals: Record<RefusalReason, number>
}

export type EntryState = "active" | "expiring" | "expired"

export type AttentionItem = {
  kind:
    | "allowlist_unavailable"
    | "authserv_missing"
    | "audit_refuses_all"
    | "bridge"
    | "refusal_spike"
    | "expiring"
    | "expired"
    | (string & {})
  severity: "critical" | "warning" | "info"
  state?: State
  time?: string | null
  count?: number
  previous?: number
  entry_id?: string
  address?: string
}

export type Overview = {
  range: Range
  generated_at: string
  bucket_seconds: number
  period: { start: string; end: string; previous_start: string }
  totals: PeriodTotals
  previous: PeriodTotals
  top_senders: {
    id: string
    address: string
    matches: number
    state: EntryState
  }[]
  attention: AttentionItem[]
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
  /** Opaque call id: 32 lower-case hex characters. */
  id: string
  time: string
  tool: Tool
  outcome: Outcome
  duration_ms: number
  login_ms: number | null
  connected?: boolean
  error_class: string | null
  action_id: string | null
  dry_run?: boolean
  source_action_id?: string | null
  chunks?: { index: number; size: number; status: ActionStatus }[]
  counts: ActivityCounts
}

export type ActivitySeriesPoint = {
  start: string
  ok: number
  refused: number
  error: number
}

export type Activity = {
  rows: ActivityRow[]
  total: number
  offset: number
  limit: number
  truncated: boolean
  series: { bucket_seconds: number; points: ActivitySeriesPoint[] }
}

export type ActivityFilters = {
  q?: string
  from?: string
  to?: string
  tools?: Tool[]
  outcomes?: Outcome[]
  refusals?: boolean
  offset?: number
  limit?: number
  tz?: string
}

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
  call_id?: string | null
  source_action_id?: string | null
  unarchive?: {
    eligible: boolean
    reason: string | null
    restored_by: string | null
  }
}

export type CallDetail = { call: ActivityRow; action: Action | null }

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

export type TimelinePoint = {
  start: string
  state: State
  ok: number
  failed: number
}

export type Incident = {
  component: string
  error_class: string
  count: number
  started_at: string
  ended_at: string
}

export type AuditCounts = {
  scanned: number
  candidates: number
  allowlisted_sender: number
  authenticated_allowlisted: number
  unverified_allowlisted: number
  with_authentication_results: number
  with_trusted_topmost: number
}

export type Enforcement = {
  authserv_configured: boolean
  store_ok: boolean
  audit: { time: string; counts: AuditCounts } | null
}

export type About = {
  version: string
  release: { tag: string; commit: string } | null
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
  timeline: TimelinePoint[]
}

export type Health = {
  checked_at: string
  state: State
  range: Range
  bucket_seconds: number
  components: HealthComponent[]
  incidents: Incident[]
  enforcement: Enforcement
  about: About
}

export type ServiceLink = {
  name: string
  url: string
  icon?: string
  colour?: string
}
export type Session = { email: string; services: ServiceLink[] }
