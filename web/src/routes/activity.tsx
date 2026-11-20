import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { formatDateTime, formatRelative } from "@zsrobinson/shell/lib/format"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@zsrobinson/shell/ui/empty"
import {
  NativeSelect,
  NativeSelectOption,
} from "@zsrobinson/shell/ui/native-select"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import { OutcomeBadge } from "@/components/badges"
import {
  countParts,
  formatInteger,
  formatMs,
  OUTCOME_LABELS,
  TOOL_LABELS,
} from "@/lib/format"
import { activityQuery } from "@/lib/queries"
import {
  OUTCOMES,
  TOOLS,
  type ActivityRow,
  type Outcome,
  type Tool,
} from "@/lib/types"

type Search = { tool?: Tool; outcome?: Outcome }

export const Route = createFileRoute("/activity")({
  staticData: { crumb: "Activity" },
  validateSearch: (search): Search => ({
    tool: TOOLS.includes(search.tool as (typeof TOOLS)[number])
      ? (search.tool as Tool)
      : undefined,
    outcome: OUTCOMES.includes(search.outcome as Outcome)
      ? (search.outcome as Outcome)
      : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, deps }) => {
    void queryClient.prefetchQuery(activityQuery(deps))
  },
  component: ActivityPage,
})

function ActivityPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const activity = useQuery(activityQuery(search))
  const filtered = Boolean(search.tool || search.outcome)
  const setFilter = (next: Search) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
  return (
    <Page>
      <PageHeader>
        <div className="flex flex-col gap-1">
          <PageTitle>Activity</PageTitle>
          {activity.data ? (
            <PageMeta>
              {activity.data.truncated
                ? `Newest ${formatInteger(activity.data.rows.length)} calls`
                : `${formatInteger(activity.data.rows.length)} calls`}
            </PageMeta>
          ) : null}
        </div>
        <PageActions>
          <NativeSelect
            aria-label="Tool"
            value={search.tool ?? ""}
            onChange={(e) =>
              setFilter({ tool: (e.target.value || undefined) as Tool })
            }
          >
            <NativeSelectOption value="">All tools</NativeSelectOption>
            {TOOLS.map((tool) => (
              <NativeSelectOption key={tool} value={tool}>
                {TOOL_LABELS[tool]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Outcome"
            value={search.outcome ?? ""}
            onChange={(e) =>
              setFilter({
                outcome: (e.target.value || undefined) as Outcome,
              })
            }
          >
            <NativeSelectOption value="">All outcomes</NativeSelectOption>
            {OUTCOMES.map((outcome) => (
              <NativeSelectOption key={outcome} value={outcome}>
                {OUTCOME_LABELS[outcome]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </PageActions>
      </PageHeader>
      {activity.isError ? (
        <QueryError
          title="Activity could not be loaded"
          error={activity.error}
          onRetry={() => void activity.refetch()}
        />
      ) : !activity.data ? (
        <Skeleton className="h-[32rem] rounded-3xl" />
      ) : activity.data.rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {filtered ? "No calls match these filters" : "No calls yet"}
            </EmptyTitle>
          </EmptyHeader>
          {filtered ? (
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => void navigate({ search: {}, replace: true })}
              >
                Clear filters
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <Card className="py-0">
          <ActivityTable rows={activity.data.rows} />
        </Card>
      )}
    </Page>
  )
}

function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">Time</TableHead>
          <TableHead>Tool</TableHead>
          <TableHead className="max-sm:hidden">Outcome</TableHead>
          <TableHead className="max-md:hidden">Counts</TableHead>
          <TableHead className="pr-5 text-right max-sm:hidden">
            Duration
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.time}-${index}`}>
            <TableCell className="pl-5 whitespace-nowrap tabular-nums">
              <time dateTime={row.time} title={formatDateTime(row.time)}>
                {formatRelative(row.time)}
              </time>
            </TableCell>
            <TableCell className="whitespace-normal max-md:w-full md:whitespace-nowrap">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {row.action_id ? (
                  <Link
                    to="/actions/$id"
                    params={{ id: row.action_id }}
                    className="font-medium underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground"
                  >
                    {TOOL_LABELS[row.tool]}
                  </Link>
                ) : (
                  <span className="font-medium">{TOOL_LABELS[row.tool]}</span>
                )}
                <span className="sm:hidden">
                  <OutcomeBadge outcome={row.outcome} />
                </span>
              </div>
              <Counts row={row} className="md:hidden" />
            </TableCell>
            <TableCell className="max-sm:hidden">
              <OutcomeBadge outcome={row.outcome} />
            </TableCell>
            <TableCell className="w-full whitespace-normal max-md:hidden">
              <Counts row={row} />
            </TableCell>
            <TableCell className="pr-5 text-right whitespace-nowrap text-muted-foreground tabular-nums max-sm:hidden">
              {formatMs(row.duration_ms)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function Counts({ row, className }: { row: ActivityRow; className?: string }) {
  const parts = countParts(row.counts)
  if (
    parts.length === 0 &&
    (!row.error_class || row.error_class === row.outcome)
  )
    return <span className={`text-muted-foreground ${className ?? ""}`}>—</span>
  return (
    <div
      className={`flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums ${className ?? ""}`}
    >
      {parts.map(([label, value]) => (
        <span key={label}>
          <span className="font-medium text-foreground">
            {formatInteger(value)}
          </span>{" "}
          {label}
        </span>
      ))}
      {row.error_class && row.error_class !== row.outcome ? (
        <span className="font-mono">{row.error_class}</span>
      ) : null}
    </div>
  )
}
