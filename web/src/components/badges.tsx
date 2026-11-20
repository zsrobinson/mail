import { cn } from "@zsrobinson/shell/lib/utils"
import { Badge } from "@zsrobinson/shell/ui/badge"
import {
  OUTCOME_LABELS,
  STATE_LABELS,
  STATUS_LABELS,
  isExpired,
} from "@/lib/format"
import type { ActionStatus, Outcome, State } from "@/lib/types"

type Tone = "good" | "warn" | "bad" | "idle"

const DOT: Record<Tone, string> = {
  good: "bg-primary",
  warn: "bg-chart-3",
  bad: "bg-destructive",
  idle: "bg-muted-foreground/50",
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full", DOT[tone], className)}
    />
  )
}

function ToneBadge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <Badge
      variant={tone === "bad" ? "destructive" : "outline"}
      // Warnings borrow the charts' "Not ok" orange so they stand out in tables.
      className={tone === "warn" ? "border-chart-3/40" : undefined}
    >
      <Dot tone={tone} />
      {label}
    </Badge>
  )
}

const STATE_TONE: Record<State, Tone> = {
  ok: "good",
  degraded: "warn",
  down: "bad",
  unknown: "idle",
}
export function StateBadge({ state }: { state: State }) {
  return <ToneBadge tone={STATE_TONE[state]} label={STATE_LABELS[state]} />
}

const OUTCOME_TONE: Record<Outcome, Tone> = {
  ok: "good",
  refused: "warn",
  error: "bad",
  busy: "warn",
}
export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return (
    <ToneBadge tone={OUTCOME_TONE[outcome]} label={OUTCOME_LABELS[outcome]} />
  )
}

const STATUS_TONE: Record<ActionStatus, Tone> = {
  completed: "good",
  partial: "warn",
  uncertain: "warn",
  failed: "bad",
  dry_run: "idle",
}
export function StatusBadge({ status }: { status: ActionStatus }) {
  return <ToneBadge tone={STATUS_TONE[status]} label={STATUS_LABELS[status]} />
}

export function ExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  return isExpired(expiresAt) ? (
    <ToneBadge tone="idle" label="Expired" />
  ) : (
    <ToneBadge tone="good" label="Active" />
  )
}
