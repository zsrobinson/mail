import { Link } from "@tanstack/react-router"
import { formatRelative } from "@zsrobinson/shell/lib/format"
import { Badge } from "@zsrobinson/shell/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@zsrobinson/shell/ui/tooltip"
import { ChevronRightIcon } from "lucide-react"
import { Dot, OutcomeBadge } from "@/components/badges"
import {
  callSummary,
  errorLabel,
  formatClock,
  formatMs,
  formatPrecise,
  OUTCOME_LABELS,
  REFUSAL_LABELS,
  shortId,
  TOOL_LABELS,
} from "@/lib/format"
import { REFUSAL_REASONS, type ActivityRow } from "@/lib/types"
import { useNow } from "@/lib/use-now"

/** Relative within a day, the clock time after that; exact on hover. */
export function CallTime({ iso }: { iso: string }) {
  const now = useNow()
  const recent = now - Date.parse(iso) < 12 * 3_600_000
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            dateTime={iso}
            className="whitespace-nowrap text-muted-foreground tabular-nums"
          />
        }
      >
        {recent ? formatRelative(iso) : formatClock(iso)}
        <span className="sr-only">, {formatPrecise(iso)}</span>
      </TooltipTrigger>
      <TooltipContent>{formatPrecise(iso)}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Only problems get a badge: refusal reasons, failures, busy turn-aways and
 * previews. A successful call stays quiet; the detail page explains each one.
 */
function RowBadges({ row }: { row: ActivityRow }) {
  const reasons = REFUSAL_REASONS.filter((r) => row.counts.refused[r] > 0)
  const problem =
    row.outcome === "error" || row.outcome === "busy" || row.dry_run
  if (reasons.length === 0 && !problem) return null
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {reasons.map((reason) => (
        <Badge
          key={reason}
          variant="outline"
          className="border-chart-3/40 text-foreground"
        >
          <Dot tone="warn" />
          {REFUSAL_LABELS[reason]}
          {row.counts.refused[reason] > 1 ? (
            <span className="text-muted-foreground tabular-nums">
              ×{row.counts.refused[reason]}
            </span>
          ) : null}
        </Badge>
      ))}
      {row.outcome === "error" || row.outcome === "busy" ? (
        <OutcomeBadge outcome={row.outcome} />
      ) : null}
      {row.outcome === "error" && row.error_class ? (
        <Badge variant="outline" className="text-muted-foreground">
          {errorLabel(row.error_class)}
        </Badge>
      ) : null}
      {row.dry_run ? <Badge variant="secondary">Preview</Badge> : null}
    </span>
  )
}

/** One call, read as time → tool and summary → problem; the row opens it. */
export function CallRow({ row }: { row: ActivityRow }) {
  const summary = callSummary(row)
  return (
    <Link
      to="/activity/$id"
      params={{ id: row.id }}
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-0.5 px-5 py-3 text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:ring-inset sm:grid-cols-[6.5rem_minmax(0,1fr)_4.5rem_1rem] sm:items-center sm:py-2.5"
    >
      <span className="text-sm max-sm:hidden">
        <CallTime iso={row.time} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-medium">{TOOL_LABELS[row.tool]}</span>
          {row.action_id ? (
            <span className="font-mono text-xs text-muted-foreground">
              {shortId(row.action_id)}
            </span>
          ) : null}
          {row.outcome === "ok" ? (
            <span className="sr-only">{OUTCOME_LABELS.ok}</span>
          ) : null}
          <RowBadges row={row} />
        </span>
        {summary ? (
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {summary}
          </span>
        ) : null}
      </span>
      <span className="flex flex-col items-end gap-0.5 text-xs sm:hidden">
        <CallTime iso={row.time} />
        <span className="text-muted-foreground tabular-nums">
          {formatMs(row.duration_ms)}
        </span>
      </span>
      <span className="text-right text-muted-foreground tabular-nums max-sm:hidden">
        {formatMs(row.duration_ms)}
      </span>
      <ChevronRightIcon
        aria-hidden
        className="size-4 text-muted-foreground/50 group-hover:text-muted-foreground max-sm:hidden"
      />
    </Link>
  )
}
