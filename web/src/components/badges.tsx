import { cn } from "@zsrobinson/shell/lib/utils"
import { Badge } from "@zsrobinson/shell/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@zsrobinson/shell/ui/tooltip"
import {
  ERROR_INFO,
  OUTCOME_LABELS,
  REFUSAL_DESCRIPTIONS,
  REFUSAL_LABELS,
  STATE_LABELS,
  STATUS_LABELS,
} from "@/lib/format"
import type {
  ActionStatus,
  EntryState,
  Outcome,
  RefusalReason,
  State,
} from "@/lib/types"

export type Tone = "good" | "warn" | "bad" | "idle"

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

export function ToneBadge({ tone, label }: { tone: Tone; label: string }) {
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

const ENTRY_TONE: Record<EntryState, Tone> = {
  active: "good",
  expiring: "warn",
  expired: "idle",
}
export const ENTRY_LABELS: Record<EntryState, string> = {
  active: "Active",
  expiring: "Expiring soon",
  expired: "Expired",
}
export function EntryStateBadge({ state }: { state: EntryState }) {
  return <ToneBadge tone={ENTRY_TONE[state]} label={ENTRY_LABELS[state]} />
}

/** A refusal reason in words, with what it means on hover. */
export function RefusalBadge({
  reason,
  count,
}: {
  reason: RefusalReason
  count?: number
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            tabIndex={0}
            className="border-chart-3/40 text-foreground"
          />
        }
      >
        <Dot tone="warn" />
        {REFUSAL_LABELS[reason]}
        {count && count > 1 ? (
          <span className="text-muted-foreground tabular-nums">×{count}</span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {REFUSAL_DESCRIPTIONS[reason]}
      </TooltipContent>
    </Tooltip>
  )
}

/** An error class in words; the raw class and its meaning on hover. */
export function ErrorClassBadge({ errorClass }: { errorClass: string }) {
  const info = ERROR_INFO[errorClass]
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="outline" tabIndex={0} className="text-foreground" />
        }
      >
        {info?.label ?? errorClass}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 flex-col items-start">
        <span className="font-mono">{errorClass}</span>
        {info ? <span>{info.description}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}
